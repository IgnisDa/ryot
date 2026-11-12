import { expect } from "bun:test";

import { AuthUnauthorized } from "@ryot-app/contract/auth-middleware";
import { getMcpOAuthResource } from "@ryot-app/contract/oauth";
import { UserId } from "@ryot-app/contract/schema/brands";
import { CapabilityId } from "@ryot-app/contract/schema/capability";
import { UTC } from "@ryot-app/contract/schema/time-zone";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { it } from "@voila.dev/effect-bun-test";
import { Deferred, Effect, Fiber, Schema } from "effect";
import { HttpRouter } from "effect/http";
import { TestClock } from "effect/testing";

import type { AgentToolsService } from "#modules/agent-tools/service";

import { makeMcpTransport, protectedResourceMetadata } from "./service";

const origin = "https://ryot.example";
const write = {
	index: 0,
	input: {},
	capability: {
		input: {},
		output: {},
		description: "Delete a page",
		source: { kind: "kernel" as const },
		id: CapabilityId.make("kernel:pages.delete"),
		hints: { readOnly: false, idempotent: false, destructive: true },
	},
};
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
	const state = { disabled: false, retiring: false };
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
							credential: { keyId: key, kind: "api-key" },
							accessClass: key.startsWith("demo") ? "demo" : "standard",
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
			call:
				call ??
				((input) =>
					Effect.gen(function* () {
						calls.push(input);
						const decision = yield* input.gate.authorize(write).pipe(Effect.orDie);
						return {
							state: "completed",
							result: { truncated: false, value: { decision, name: input.name } },
						} as const;
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
		query = "",
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
					new Request(`${origin}/api/mcp${query}`, {
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

const initialize = Effect.fn(function* (
	request: Effect.Success<ReturnType<typeof makeHarness>>["request"],
	key: string,
	query: string,
) {
	const response = yield* request(
		"initialize",
		key,
		undefined,
		{ capabilities: {}, protocolVersion: "2025-06-18", clientInfo: { name: "test", version: "1" } },
		1,
		query,
	);
	const session = response.headers.get("mcp-session-id");
	if (!session) {
		throw new Error("Missing MCP session");
	}
	yield* Effect.promise(() => response.text());
	return session;
});

const toolNames = Effect.fn(function* (response: Response) {
	return (yield* parseFrame(yield* Effect.promise(() => response.text()))).result.tools.map(
		({ name }) => name,
	);
});

it.live(
	"authenticates every request, isolates sessions and serves the fixed tools with a write gate",
	() =>
		Effect.gen(function* () {
			const { calls, state, request } = yield* makeHarness();
			const unauthorized = yield* request("tools/list");
			expect(unauthorized.status).toBe(401);
			expect(unauthorized.headers.get("www-authenticate")).toContain(
				"/.well-known/oauth-protected-resource/api/mcp",
			);
			const session = yield* initialize(request, "alice", "");
			const listed = yield* request("tools/list", "alice", session);
			const tools = (yield* parseFrame(yield* Effect.promise(() => listed.text()))).result.tools;
			expect(tools.map(({ name }) => name)).toEqual([
				"search",
				"execute",
				"read_docs",
				"page_write",
				"page_publish",
			]);
			expect(tools.find(({ name }) => name === "execute")?.annotations).toEqual({
				readOnlyHint: false,
				openWorldHint: true,
				idempotentHint: false,
				destructiveHint: true,
			});
			const called = yield* request("tools/call", "alice", session, {
				name: "execute",
				arguments: { code: "return 1;" },
			});
			expect(called.status).toBe(200);
			expect(yield* Effect.promise(() => called.text())).toContain('\\"approved\\":true');
			expect(calls).toHaveLength(1);
			expect(calls[0]?.name).toBe("execute");
			expect(calls[0]?.headers["x-api-key"]).toBe("alice");
			expect(calls[0]?.resource).toBe(getMcpOAuthResource(origin));
			const foreign = yield* request("tools/list", "bob", session);
			expect(foreign.status).toBe(404);
			yield* Effect.promise(() => foreign.text());
			state.retiring = true;
			expect(
				(yield* request("tools/call", "alice", session, { arguments: {}, name: "search" })).status,
			).toBe(401);
			state.retiring = false;
			state.disabled = true;
			expect(
				(yield* request("tools/call", "alice", session, { arguments: {}, name: "search" })).status,
			).toBe(401);
			expect(calls).toHaveLength(1);
		}).pipe(Effect.scoped),
	testTimeout,
);

it.live(
	"read-only and demo connections hide page writes and read-only connections refuse writes",
	() =>
		Effect.gen(function* () {
			const { calls, request } = yield* makeHarness();
			const readOnly = yield* initialize(request, "alice", "?readonly=true");
			expect(
				yield* toolNames(
					yield* request("tools/list", "alice", readOnly, undefined, 1, "?readonly=true"),
				),
			).toEqual(["search", "execute", "read_docs"]);
			const refused = yield* request(
				"tools/call",
				"alice",
				readOnly,
				{ name: "execute", arguments: { code: "return 1;" } },
				1,
				"?readonly=true",
			);
			expect(yield* Effect.promise(() => refused.text())).toContain(
				"This MCP connection is read-only",
			);
			expect(calls).toHaveLength(1);
			const writable = yield* request("tools/list", "alice", readOnly);
			expect(writable.status).toBe(404);
			yield* Effect.promise(() => writable.text());
			const demo = yield* initialize(request, "demo-user", "");
			expect(yield* toolNames(yield* request("tools/list", "demo-user", demo))).toEqual([
				"search",
				"execute",
				"read_docs",
			]);
		}).pipe(Effect.scoped),
);

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
			const session = yield* initialize(request, "alice", "");
			const pending = yield* request("tools/call", "alice", session, {
				arguments: {},
				name: "search",
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
			const session = yield* initialize(request, "alice", "");
			const pending = yield* request("tools/call", "alice", session, {
				arguments: {},
				name: "search",
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
