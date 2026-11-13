import { AuthUnauthorized } from "@ryot-app/contract/auth-middleware";
import {
	AuthorizationContext,
	getMcpOAuthResource,
	getMcpResourceMetadataUrl,
	getOAuthIssuer,
} from "@ryot-app/contract/oauth";
import { JsonValue } from "@ryot-app/contract/schema/json";
import { strictStruct } from "@ryot-app/contract/schema/utils";
import { Context, Deferred, Effect, Layer, Schedule, Schema, ScopedCache } from "effect";
import { McpProtocol, McpSchema, McpServer } from "effect/ai";
import { Headers, HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";

import { LifecycleWriteGuard } from "#modules/accounts/auth/lifecycle-write-guard";
import { oauthPolicy, oauthResourcePolicies } from "#modules/accounts/auth/oauth-policy";
import { AuthService } from "#modules/accounts/auth/service";
import type { WriteGate } from "#modules/agent-tools/execute";
import {
	AgentToolsService,
	availableAgentTools,
	writesDirectly,
} from "#modules/agent-tools/service";
import { RYOT_VERSION } from "#platform/build-info";
import { AppConfig } from "#platform/config/service";

const RequestHeaders = Context.Reference<Headers.Headers>(
	"@ryot-app/kernel-backend/modules/mcp/RequestHeaders",
	{ defaultValue: () => Headers.empty },
);

export const protectedResourceMetadata = (origin: string) => ({
	bearer_methods_supported: ["header"],
	resource: getMcpOAuthResource(origin),
	authorization_servers: [getOAuthIssuer(origin)],
	scopes_supported: oauthResourcePolicies(origin).mcp.allowedScopes,
});

const ConnectionIdentity = strictStruct({
	readOnly: Schema.Boolean,
	authorization: AuthorizationContext,
});
const isReadOnlyRequest = (url: string) =>
	new URL(url, "http://localhost").searchParams.get("readonly") === "true";

export const makeMcpTransport = Effect.fn("makeMcpTransport")(function* (
	auth: Pick<AuthService["Service"], "resolveRequestCredential">,
	tools: Pick<AgentToolsService["Service"], "call">,
	origin: string,
	lifecycle: Pick<LifecycleWriteGuard["Service"], "isActive">,
) {
	const resource = getMcpOAuthResource(origin);
	const middleware = McpServer.middleware(
		(effect, { headers }) => Effect.provideService(effect, RequestHeaders, headers),
		{ global: true },
	);
	const connections = yield* ScopedCache.make({
		capacity: 1024,
		timeToLive: "30 minutes",
		lookup: (identity: string) =>
			Effect.gen(function* () {
				const { readOnly, authorization } = yield* Schema.decodeEffect(
					Schema.fromJsonString(ConnectionIdentity),
				)(identity).pipe(Effect.orDie);
				const gate: WriteGate = {
					settle: () => Effect.void,
					authorize: () =>
						Effect.succeed(
							readOnly
								? { approved: false, reason: "This MCP connection is read-only" }
								: { approved: true },
						),
				};
				const registryReady = yield* Deferred.make<McpServer.McpServer["Service"]>();
				const registrations = Layer.effectDiscard(
					Effect.gen(function* () {
						const registry = yield* McpServer.McpServer;
						yield* Deferred.succeed(registryReady, registry);
					}),
				).pipe(Layer.provide(middleware));
				const connectionMemoMap = yield* Layer.makeMemoMap;
				const app = yield* HttpRouter.toHttpEffect(
					McpServer.layerHttp({
						name: "Ryot",
						registrations,
						path: "/api/mcp",
						version: RYOT_VERSION,
						allowedOrigins: [origin],
						allowSubscriptions: false,
						allowSessionTermination: true,
						protocols: [
							McpProtocol.v2026_07_28,
							McpProtocol.v2025_11_25,
							McpProtocol.v2025_06_18,
							McpProtocol.v2025_03_26,
						],
					}),
				).pipe(Effect.provideService(Layer.CurrentMemoMap, connectionMemoMap));
				const registry = yield* Deferred.await(registryReady);
				for (const tool of availableAgentTools(authorization.accessClass)) {
					if (readOnly && writesDirectly(tool)) {
						continue;
					}
					const inputSchema = yield* Schema.decodeEffect(McpSchema.ToolJson)({
						type: "object",
						...tool.input,
					}).pipe(Effect.orDie);
					yield* registry.addTool({
						annotations: Context.empty(),
						tool: new McpSchema.Tool({
							inputSchema,
							name: tool.name,
							description: tool.description,
							annotations: {
								openWorldHint: true,
								readOnlyHint: tool.hints.readOnly,
								idempotentHint: tool.hints.idempotent,
								destructiveHint: tool.hints.destructive,
							},
						}),
						handle: (argumentsValue: unknown) =>
							Effect.gen(function* () {
								const headers = yield* RequestHeaders;
								const args = yield* Schema.decodeUnknownEffect(JsonValue)(
									argumentsValue ?? {},
								).pipe(
									Effect.mapError(
										() => new McpSchema.InvalidParams({ message: "Tool arguments must be JSON." }),
									),
								);
								const outcome = yield* tools.call({
									gate,
									headers,
									resource,
									name: tool.name,
									arguments: args,
								});
								if (outcome.state === "suspended") {
									return yield* Effect.die("MCP tool calls cannot suspend");
								}
								return new McpSchema.CallToolResult({
									content: [
										{
											type: "text",
											text: yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(
												outcome.result,
											).pipe(Effect.orDie),
										},
									],
								});
							}).pipe(
								Effect.catch((error) =>
									Effect.succeed(
										new McpSchema.CallToolResult({
											isError: true,
											content: [{ type: "text", text: error.message }],
										}),
									),
								),
							),
					});
				}
				return { app };
			}),
	});
	yield* ScopedCache.keys(connections).pipe(
		Effect.repeat(Schedule.spaced("1 minute")),
		Effect.forkScoped,
	);
	const handle = Effect.gen(function* () {
		const request = yield* HttpServerRequest.HttpServerRequest;
		const { user, authorization } = yield* auth.resolveRequestCredential(
			new globalThis.Headers(request.headers),
			resource,
		);
		if (
			request.method !== "GET" &&
			request.method !== "HEAD" &&
			request.method !== "OPTIONS" &&
			(yield* lifecycle.isActive(user.id).pipe(Effect.orDie))
		) {
			return yield* new AuthUnauthorized({ reason: { code: "write-blocked" } });
		}
		const identity = yield* Schema.encodeEffect(Schema.fromJsonString(ConnectionIdentity))({
			authorization,
			readOnly: isReadOnlyRequest(request.url),
		}).pipe(Effect.orDie);
		const { app } = yield* ScopedCache.get(connections, identity).pipe(Effect.orDie);
		return yield* app;
	}).pipe(
		Effect.catchTag("AuthUnauthorized", () =>
			Effect.succeed(
				HttpServerResponse.empty({
					status: 401,
					headers: {
						"Cache-Control": "no-store",
						"WWW-Authenticate": `Bearer resource_metadata="${getMcpResourceMetadataUrl(origin)}", scope="${oauthPolicy.requiredScopes.join(" ")}"`,
					},
				}),
			),
		),
	);
	return { handle };
});

export class McpService extends Context.Service<McpService>()(
	"@ryot-app/kernel-backend/modules/mcp/service/McpService",
	{
		make: Effect.gen(function* () {
			const auth = yield* AuthService;
			const tools = yield* AgentToolsService;
			const config = yield* AppConfig;
			const lifecycle = yield* LifecycleWriteGuard;
			return yield* makeMcpTransport(auth, tools, config.frontendUrl, lifecycle);
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
