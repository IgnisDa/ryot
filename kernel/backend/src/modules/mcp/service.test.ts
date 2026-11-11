import { expect } from "bun:test";

import { AuthUnauthorized } from "@ryot-app/contract/auth-middleware";
import { getMcpOAuthResource } from "@ryot-app/contract/oauth";
import { UserId } from "@ryot-app/contract/schema/brands";
import { UTC } from "@ryot-app/contract/schema/time-zone";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { it } from "@voila.dev/effect-bun-test";
import { Deferred, Effect, Fiber, Schema } from "effect";
import { HttpRouter } from "effect/http";
import { TestClock } from "effect/testing";

import type { AgentTool, AgentToolsService } from "#modules/agent-tools/service";

import { makeMcpTransport, protectedResourceMetadata } from "./service";

const origin = "https://ryot.example";
const descriptor = (name: string): AgentTool => ({
	name,
	output: { type: "object" },
	description: `Describe ${name}`,
	source: { kind: "describe-data" },
	hints: { readOnly: true, idempotent: true, destructive: false },
	input: { $ref: "#/$defs/Input", $defs: { Input: { type: "object", properties: {} } } },
});
const SessionResult = Schema.Struct({
	result: Schema.Struct({
		tools: Schema.Array(
			Schema.Struct({
				name: Schema.String,
				annotations: Schema.Struct({
					readOnlyHint: Schema.Boolean,
					openWorldHint: Schema.Boolean,
					idempotentHint: Schema.Boolean,
					destructiveHint: Schema.Boolean,
				}),
			}),
		),
	}),
});

const parseFrame = (text: string) =>
	Schema.decodeEffect(Schema.fromJsonString(SessionResult))(
		text
			.split("\n")
			.find((line) => line.startsWith("data: "))
			?.slice(6) ?? text,
	);

const makeHarness = Effect.fn(function* (call?: AgentToolsService["Service"]["call"]) {
	const context = yield* Effect.context();
	const calls: Parameters<AgentToolsService["Service"]["call"]>[0][] = [];
	const state = { disabled: false, retiring: false, names: ["first"] };
	const transport = yield* makeMcpTransport(
		{
			resolveRequestCredential: (headers, resource) =>
				Effect.gen(function* () {
					expect(resource).toBe(getMcpOAuthResource(origin));
					const key = headers.get("x-api-key");
					if (!key || state.disabled) {
						return yield* new AuthUnauthorized({ reason: { code: "authentication-required" } });
					}
					return {
						authorization: {
							userId: key,
							accessClass: "standard",
							credential: { keyId: key, kind: "api-key" },
						},
						user: {
							name: key,
							image: null,
							id: UserId.make(key),
							email: `${key}@example.com`,
							preferences: {
								language: null,
								reportingTimeZone: UTC,
								ratingScale: "hundred",
								disableIntegrations: false,
							},
						},
					};
				}),
		},
		{
			list: () => Effect.succeed(state.names.map(descriptor)),
			call:
				call ??
				((input) =>
					Effect.sync(() => {
						calls.push(input);
						return { truncated: false, value: { name: input.name } };
					})),
		},
		origin,
		{ isActive: () => Effect.succeed(state.retiring) },
	);
	const web = HttpRouter.toWebHandler(HttpRouter.add("*", "/api/mcp", transport.handle), {
		disableLogger: true,
	});
	yield* Effect.addFinalizer(() => Effect.promise(web.dispose));
	const request = (
		method: string,
		key?: string,
		session?: string,
		params?: unknown,
		id: null | number = 1,
	) =>
		Effect.gen(function* () {
			const body = yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))({
				...(id === null ? {} : { id }),
				method,
				params,
				jsonrpc: "2.0",
			});
			return yield* Effect.promise(() =>
				web.handler(
					new Request(`${origin}/api/mcp`, {
						body: method === "DELETE" ? undefined : body,
						method: method === "DELETE" ? "DELETE" : "POST",
						headers: {
							"content-type": "application/json",
							accept: "application/json, text/event-stream",
							...(key ? { "x-api-key": key } : {}),
							...(session
								? { "mcp-session-id": session, "mcp-protocol-version": "2025-06-18" }
								: {}),
						},
					}),
					context,
				),
			);
		});

	return { calls, state, request };
});

it.live(
	"authenticates every request, isolates sessions, refreshes tools and delegates with request credentials",
	() =>
		Effect.gen(function* () {
			const { calls, state, request } = yield* makeHarness();
			const unauthorized = yield* request("tools/list");
			expect(unauthorized.status).toBe(401);
			expect(unauthorized.headers.get("www-authenticate")).toContain(
				"/.well-known/oauth-protected-resource/api/mcp",
			);
			const init = yield* request("initialize", "alice", undefined, {
				capabilities: {},
				protocolVersion: "2025-06-18",
				clientInfo: { name: "test", version: "1" },
			});
			expect(init.status).toBe(200);
			const session = init.headers.get("mcp-session-id");
			expect(session).toBeString();
			if (!session) {
				throw new Error("Missing MCP session");
			}
			yield* Effect.promise(() => init.text());
			const listed = yield* request("tools/list", "alice", session);
			const listText = yield* Effect.promise(() => listed.text());

			expect((yield* parseFrame(listText)).result.tools).toEqual([
				{
					name: "first",
					annotations: {
						readOnlyHint: true,
						openWorldHint: true,
						idempotentHint: true,
						destructiveHint: false,
					},
				},
			]);
			const called = yield* request("tools/call", "alice", session, {
				name: "first",
				arguments: {},
			});
			expect(called.status).toBe(200);
			expect(yield* Effect.promise(() => called.text())).toContain("first");
			expect(calls).toHaveLength(1);
			expect(calls[0]?.headers["x-api-key"]).toBe("alice");
			expect(calls[0]?.resource).toBe(getMcpOAuthResource(origin));
			const foreign = yield* request("tools/list", "bob", session);
			expect(foreign.status).toBe(404);
			yield* Effect.promise(() => foreign.text());
			state.names = ["second"];
			const changed = yield* request("tools/list", "alice", session);
			expect(
				(yield* parseFrame(yield* Effect.promise(() => changed.text()))).result.tools.map(
					({ name }) => name,
				),
			).toEqual(["second"]);
			state.retiring = true;
			expect(
				(yield* request("tools/call", "alice", session, { arguments: {}, name: "second" })).status,
			).toBe(401);
			state.retiring = false;
			state.disabled = true;
			expect(
				(yield* request("tools/call", "alice", session, { arguments: {}, name: "second" })).status,
			).toBe(401);
			expect(calls).toHaveLength(1);
		}).pipe(Effect.scoped),
	testTimeout,
);

const initialize = Effect.fn(function* (
	request: Effect.Success<ReturnType<typeof makeHarness>>["request"],
) {
	const response = yield* request("initialize", "alice", undefined, {
		capabilities: {},
		protocolVersion: "2025-06-18",
		clientInfo: { name: "test", version: "1" },
	});
	const session = response.headers.get("mcp-session-id");
	if (!session) {
		throw new Error("Missing MCP session");
	}
	yield* Effect.promise(() => response.text());
	return session;
});

for (const action of ["cancel", "terminate"] as const) {
	it.live(`allows ${action} while a tool call is waiting`, () =>
		Effect.gen(function* () {
			const started = yield* Deferred.make<void>();
			const interrupted = yield* Deferred.make<void>();
			const { request } = yield* makeHarness(() =>
				Deferred.succeed(started, undefined).pipe(
					Effect.andThen(Effect.never),
					Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined)),
				),
			);
			const session = yield* initialize(request);
			const pending = yield* request("tools/call", "alice", session, {
				name: "first",
				arguments: {},
			}).pipe(Effect.forkScoped);
			yield* Deferred.await(started);
			const response =
				action === "cancel"
					? yield* request("notifications/cancelled", "alice", session, { requestId: 1 }, null)
					: yield* request("DELETE", "alice", session);
			expect(response.status).toBe(action === "cancel" ? 202 : 204);
			yield* Deferred.await(interrupted);
			const result = yield* Fiber.join(pending);
			yield* Effect.promise(() => result.text());
		}).pipe(Effect.scoped, Effect.timeout("5 seconds")),
	);
}

it.effect(
	"expires abandoned sessions and interrupts their work without another authenticated request",
	() =>
		Effect.gen(function* () {
			const started = yield* Deferred.make<void>();
			const interrupted = yield* Deferred.make<void>();
			const { state, request } = yield* makeHarness(() =>
				Deferred.succeed(started, undefined).pipe(
					Effect.andThen(Effect.never),
					Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined)),
				),
			);
			const session = yield* initialize(request);
			const pending = yield* request("tools/call", "alice", session, {
				name: "first",
				arguments: {},
			}).pipe(Effect.forkScoped);
			yield* Deferred.await(started);
			state.disabled = true;
			yield* TestClock.adjust("31 minutes");
			expect(yield* Deferred.isDone(interrupted)).toBe(true);
			const result = yield* Fiber.join(pending);
			yield* Effect.promise(() => result.text());
			state.disabled = false;
			const expired = yield* request("tools/list", "alice", session);
			expect(expired.status).toBe(404);
			yield* Effect.promise(() => expired.text());
		}).pipe(Effect.scoped),
);

it("advertises the MCP resource and its authorization server", () => {
	expect(protectedResourceMetadata(origin)).toEqual({
		resource: `${origin}/api/mcp`,
		scopes_supported: ["ryot:api"],
		bearer_methods_supported: ["header"],
		authorization_servers: [`${origin}/api/auth`],
	});
});
