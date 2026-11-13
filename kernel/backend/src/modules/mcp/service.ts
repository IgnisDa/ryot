import { AuthUnauthorized } from "@ryot-app/contract/auth-middleware";
import { BadRequest } from "@ryot-app/contract/errors";
import {
	AuthorizationContext,
	getMcpOAuthResource,
	getMcpResourceMetadataUrl,
	getOAuthIssuer,
} from "@ryot-app/contract/oauth";
import { approvalSubject, type ApprovalTarget } from "@ryot-app/contract/schema/approval";
import { JsonValue } from "@ryot-app/contract/schema/json";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { generateId } from "better-auth";
import { Context, Deferred, Effect, Layer, Option, Schedule, Schema, ScopedCache } from "effect";
import { McpProtocol, McpSchema, McpServer } from "effect/ai";
import { Headers, HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";

import { LifecycleWriteGuard } from "#modules/accounts/auth/lifecycle-write-guard";
import { oauthPolicy, oauthResourcePolicies } from "#modules/accounts/auth/oauth-policy";
import { AuthService } from "#modules/accounts/auth/service";
import { changeDeclined, confirmationUnavailable } from "#modules/agent-tools/execute";
import {
	agentToolHints,
	AgentToolsService,
	availableAgentTools,
	requiresCallConfirmation,
} from "#modules/agent-tools/service";
import { AgentRunSuspended } from "#modules/scripts/agent/service";
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

const ElicitationResponse = Schema.Struct({
	action: Schema.Literals(["accept", "decline", "cancel"]),
});

const supportsFormElicitation = (capabilities: McpSchema.ClientCapabilities) =>
	capabilities.elicitation !== undefined &&
	(capabilities.elicitation.form !== undefined || capabilities.elicitation.url === undefined);

const confirmationMessage = (target: ApprovalTarget, input: JsonValue) => {
	const subject = approvalSubject(target, (packageId) => packageId);
	return `Allow ${subject.title} (${subject.source})?\n\n${subject.description}\n\nInput:\n${stableStringify(input)}`;
};

const writeDecision = (
	approved: boolean,
): { readonly approved: true } | { readonly reason: string; readonly approved: false } =>
	approved ? { approved: true } : { approved: false, reason: changeDeclined };

const mcpConfirmation = Effect.gen(function* () {
	const context = yield* McpSchema.McpRequestContext;
	const reverse = yield* Effect.serviceOption(McpSchema.McpServerClient);
	const pending: Record<string, McpSchema.McpInputRequest> = {};
	const confirm = (
		key: string,
		target: ApprovalTarget,
		input: JsonValue,
	): Effect.Effect<boolean, AgentRunSuspended> => {
		const params = {
			mode: "form" as const,
			message: confirmationMessage(target, input),
			requestedSchema: { properties: {}, type: "object" as const },
		};
		if (Option.isSome(reverse)) {
			return Effect.gen(function* () {
				const client = yield* reverse.value.getClient;
				const result = yield* client.elicit(new McpSchema.ElicitRequestFormParams(params));
				return result.action === "accept";
			}).pipe(
				Effect.scoped,
				Effect.orElseSucceed(() => false),
			);
		}
		const response = context.inputResponses?.[key];
		if (response !== undefined) {
			return Schema.decodeUnknownEffect(ElicitationResponse)(response).pipe(
				Effect.map(({ action }) => action === "accept"),
				Effect.orElseSucceed(() => false),
			);
		}
		pending[key] = { params, method: "elicitation/create" };
		return Effect.fail(new AgentRunSuspended());
	};
	return {
		pending,
		requestState: context.requestState ?? generateId(),
		confirm: supportsFormElicitation(context.clientCapabilities) ? confirm : null,
	};
});

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
				const authorization = yield* Schema.decodeEffect(
					Schema.fromJsonString(AuthorizationContext),
				)(identity).pipe(Effect.orDie);
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
				for (const tool of availableAgentTools(authorization)) {
					const inputSchema = yield* Schema.decodeEffect(McpSchema.ToolJson)({
						type: "object",
						...tool.input,
					}).pipe(Effect.orDie);
					const hints = agentToolHints(tool, authorization.writeAccess);
					yield* registry.addTool({
						annotations: Context.empty(),
						tool: new McpSchema.Tool({
							inputSchema,
							name: tool.name,
							description: tool.description,
							annotations: {
								openWorldHint: true,
								readOnlyHint: hints.readOnly,
								idempotentHint: hints.idempotent,
								destructiveHint: hints.destructive,
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
								const { confirm, pending, requestState } = yield* mcpConfirmation;
								if (requiresCallConfirmation(tool, authorization.writeAccess)) {
									if (confirm === null) {
										return yield* new BadRequest({ message: confirmationUnavailable });
									}
									if (!(yield* confirm("call", { kind: "tool", tool: tool.name }, args))) {
										return yield* new BadRequest({ message: changeDeclined });
									}
								}
								const outcome = yield* tools.call({
									headers,
									resource,
									name: tool.name,
									arguments: args,
									idempotencyKey: `mcp:${requestState}`,
									confirm:
										confirm === null
											? null
											: {
													settle: () => Effect.void,
													authorize: (write) =>
														confirm(
															`write-${write.index}`,
															{ kind: "capability", capability: write.capability },
															write.input,
														).pipe(Effect.map(writeDecision)),
												},
								});
								if (outcome.state === "suspended") {
									return new McpSchema.InputRequired({ requestState, inputRequests: pending });
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
								Effect.catchTag("AgentRunSuspended", (): Effect.Effect<McpSchema.InputRequired> =>
									Effect.die("MCP confirmation suspended outside an input request"),
								),
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
		const identity = yield* Schema.encodeEffect(Schema.fromJsonString(AuthorizationContext))(
			authorization,
		).pipe(Effect.orDie);
		const { app } = yield* ScopedCache.get(connections, identity).pipe(Effect.orDie);
		return yield* app;
	}).pipe(
		Effect.catchTag("AuthUnauthorized", () =>
			Effect.succeed(
				HttpServerResponse.empty({
					status: 401,
					headers: {
						"Cache-Control": "no-store",
						"WWW-Authenticate": `Bearer resource_metadata="${getMcpResourceMetadataUrl(origin)}", scope="${oauthPolicy.challengeScopes.join(" ")}"`,
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
