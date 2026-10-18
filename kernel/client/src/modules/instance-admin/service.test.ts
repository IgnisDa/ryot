import { describe, expect, layer } from "@effect/vitest";
import type { ContractSuccess } from "@ryot-app/contract/client";
import type { ImpersonationAuthorization } from "@ryot-app/contract/oauth";
import { UserId } from "@ryot-app/contract/schema/brands";
import type { PreparedRecipe } from "@ryot-app/ryotql";
import { Context, Effect, Fiber, Layer, Ref, Result } from "effect";
import { TestClock } from "effect/testing";

import { decodeServerOrigin, type ServerOrigin } from "#/api/origin";
import { makeInstanceAdminApi } from "#/api/ports.test-layer";
import {
	InstanceAdminService,
	InstanceAdminSessionNotFound,
} from "#/modules/instance-admin/service";
import {
	InstanceAdminSessionService,
	makeInstanceAdminSessionService,
} from "#/modules/instance-admin/session";
import type { InstanceAdminUserLifecycleOperation } from "#/modules/instance-admin/user-lifecycle";

const origin = decodeServerOrigin("https://ryot.example");
const otherOrigin = decodeServerOrigin("https://other.example");

const operation = (
	kind: InstanceAdminUserLifecycleOperation["kind"],
	status: InstanceAdminUserLifecycleOperation["status"],
	overrides: Partial<InstanceAdminUserLifecycleOperation> = {},
): InstanceAdminUserLifecycleOperation => ({
	kind,
	status,
	failure: null,
	startedAt: null,
	finishedAt: null,
	resetResult: null,
	id: `${kind}-operation`,
	userId: UserId.make("user-1"),
	createdAt: "2026-09-01T00:00:00.000Z",
	...overrides,
});

const page = (items: readonly unknown[]) => ({
	items,
	type: "rows" as const,
	pageInfo: { limit: 50, hasMore: false, nextCursor: null },
});

type InstanceAdminCall = {
	readonly name: string;
	readonly token: string;
	readonly request?: unknown;
	readonly origin: ServerOrigin;
	readonly document?: PreparedRecipe<unknown>["document"];
};

const resetResult = {
	email: "reader@example.com",
	userId: UserId.make("user-1"),
	resetUrl: "https://ryot.example/reset-password?token=reset-secret",
};

const authorization: ImpersonationAuthorization = {
	nonce: "nonce-1",
	state: "state-1",
	codeChallenge: "challenge-1",
	clientId: "ryot-impersonation-web",
	redirectUri: "https://ryot.example/auth/callback",
};

class FakeInstanceAdminApi extends Context.Service<
	FakeInstanceAdminApi,
	{
		readonly lifecyclePolls: Effect.Effect<number>;
		readonly calls: Effect.Effect<ReadonlyArray<InstanceAdminCall>>;
	}
>()("test/FakeInstanceAdminApi") {}

const instanceAdminLayer = () =>
	Layer.unwrap(
		Effect.gen(function* () {
			const calls = yield* Ref.make<ReadonlyArray<InstanceAdminCall>>([]);
			const lifecyclePolls = yield* Ref.make(0);
			let nextSession = 0;
			const session = Layer.succeed(
				InstanceAdminSessionService,
				makeInstanceAdminSessionService(() => `session-${++nextSession}`),
			);
			const recordCall = (call: InstanceAdminCall) => Ref.update(calls, (all) => [...all, call]);
			const record =
				<
					M extends
						| "resetUser"
						| "deleteUser"
						| "setUserDisabled"
						| "resetUserPassword"
						| "startUserImpersonation",
				>(
					name: M,
					respond: () => ContractSuccess<"instanceAdmin", M>,
				) =>
				(requestedOrigin: ServerOrigin, token: string, request?: unknown) =>
					recordCall({ name, token, request, origin: requestedOrigin }).pipe(Effect.map(respond));
			const instanceAdmin = makeInstanceAdminApi({
				resetUser: record("resetUser", () => ({ operationId: "reset-operation" })),
				deleteUser: record("deleteUser", () => ({ operationId: "delete-operation" })),
				setUserDisabled: record("setUserDisabled", () => ({ id: UserId.make("user-1") })),
				resetUserPassword: record("resetUserPassword", () => ({
					email: resetResult.email,
					resetUrl: resetResult.resetUrl,
				})),
				startUserImpersonation: record("startUserImpersonation", () => ({
					ticket: "handoff-ticket",
					expiresAt: 1_800_000_000_000,
				})),
				listLogs: (requestedOrigin, token, after, limit) =>
					recordCall({
						token,
						name: "listLogs",
						origin: requestedOrigin,
						request: { after, limit },
					}).pipe(
						Effect.map(() => ({
							files: [],
							pageInfo: { limit, hasMore: false, nextCursor: null },
						})),
					),
				query: (requestedOrigin, token, recipe) =>
					Effect.gen(function* () {
						yield* recordCall({
							token,
							name: "query",
							origin: requestedOrigin,
							document: recipe.document,
						});
						const queries = recipe.document.queries;
						let response: unknown;
						if (Object.hasOwn(queries, "users")) {
							response = {
								data: {
									total: { type: "aggregate", items: [{ count: 1 }] },
									users: page([
										{
											id: "user-1",
											name: "Reader",
											disabledAt: null,
											authState: "credential",
											twoFactorEnabled: false,
											email: "reader@example.com",
											createdAt: "2026-09-01T00:00:00.000Z",
										},
									]),
								},
							};
						} else if (Object.hasOwn(queries, "entries")) {
							response = { data: { entries: page([]) } };
						} else if (Object.hasOwn(queries, "operation")) {
							yield* Ref.update(lifecyclePolls, (count) => count + 1);
							const deleted = (yield* Ref.get(calls)).some(({ name }) => name === "deleteUser");
							response = {
								data: {
									operation: page([
										deleted
											? operation("delete", "completed")
											: operation("reset", "completed", { resetResult }),
									]),
								},
							};
						} else {
							return yield* Effect.die(new Error("Unexpected admin query"));
						}
						return Result.getOrThrow(recipe.decode(response));
					}),
			});
			return Layer.mergeAll(
				InstanceAdminService.layer.pipe(Layer.provide(instanceAdmin), Layer.provide(session)),
				session,
				Layer.succeed(FakeInstanceAdminApi, {
					calls: Ref.get(calls),
					lifecyclePolls: Ref.get(lifecyclePolls),
				}),
			);
		}),
	);

describe("Instance Admin service", () => {
	layer(instanceAdminLayer())((test) => {
		test.effect("uses each session's admin origin and token for cursor reads and writes", () => {
			return Effect.gen(function* () {
				const sessions = yield* InstanceAdminSessionService;
				const api = yield* FakeInstanceAdminApi;
				const sessionId = yield* sessions.create(origin, "admin-secret");
				const service = yield* InstanceAdminService;

				const users = yield* service.listUsers(sessionId, "reader", undefined, 25);
				expect(users).toMatchObject({ total: 1, items: [{ email: "reader@example.com" }] });
				expect((yield* service.listUsers(sessionId, "reader", "cursor-2", 25)).total).toBe(1);
				expect(yield* service.getMigrationReport(sessionId, "report-cursor")).toMatchObject({
					items: [],
					pageInfo: { nextCursor: null },
				});
				expect(yield* service.resetUserPassword(sessionId, "user-1")).toEqual({
					email: resetResult.email,
					resetUrl: resetResult.resetUrl,
				});
				expect(yield* service.setUserDisabled(sessionId, "user-1", true)).toMatchObject({
					id: "user-1",
				});
				expect((yield* service.deleteUser(sessionId, "user-1")).status).toBe("completed");

				expect((yield* api.calls)[6]?.document?.queries.operation).toMatchObject({
					from: { table: "userLifecycleOperation" },
				});
				const otherSessionId = yield* sessions.create(otherOrigin, "other-secret");
				expect((yield* service.listUsers(otherSessionId, "", undefined, 50)).total).toBe(1);
				const calls = yield* api.calls;
				expect(
					calls.map(({ token, origin: requestedOrigin }) => ({ token, origin: requestedOrigin })),
				).toEqual([
					...Array.from({ length: 7 }, () => ({ origin, token: "admin-secret" })),
					{ origin: otherOrigin, token: "other-secret" },
				]);
				expect(calls[0]?.document?.queries.users).toMatchObject({
					output: { pagination: { limit: 25 } },
				});
				expect(calls[1]?.document?.queries.users).toMatchObject({
					output: { pagination: { limit: 25, after: "cursor-2" } },
				});
				expect(calls[2]?.document?.queries.entries).toMatchObject({
					output: { pagination: { limit: 50, after: "report-cursor" } },
				});
				expect(calls.slice(3, 7).map(({ name, request }) => ({ name, request }))).toEqual([
					{ name: "resetUserPassword", request: { params: { userId: "user-1" } } },
					{
						name: "setUserDisabled",
						request: { payload: { disabled: true }, params: { userId: "user-1" } },
					},
					{ name: "deleteUser", request: { params: { userId: "user-1" } } },
					{ name: "query", request: undefined },
				]);
			});
		});
	});

	layer(instanceAdminLayer())((test) => {
		test.effect("starts impersonation with the session credentials and authorization", () =>
			Effect.gen(function* () {
				const sessions = yield* InstanceAdminSessionService;
				const sessionId = yield* sessions.create(origin, "admin-secret");
				const service = yield* InstanceAdminService;
				const api = yield* FakeInstanceAdminApi;

				expect(yield* service.startUserImpersonation(sessionId, "user-1", authorization)).toEqual({
					ticket: "handoff-ticket",
					expiresAt: 1_800_000_000_000,
				});
				expect(yield* api.calls).toEqual([
					{
						origin,
						token: "admin-secret",
						name: "startUserImpersonation",
						request: { payload: authorization, params: { userId: "user-1" } },
					},
				]);
			}),
		);
	});

	layer(instanceAdminLayer())((test) => {
		test.effect("passes server log cursors and limits through the session API", () =>
			Effect.gen(function* () {
				const sessions = yield* InstanceAdminSessionService;
				const sessionId = yield* sessions.create(origin, "admin-secret");
				const service = yield* InstanceAdminService;
				const api = yield* FakeInstanceAdminApi;

				expect((yield* service.listLogs(sessionId, undefined, 25)).files).toEqual([]);
				expect((yield* service.listLogs(sessionId, "log-cursor", 25)).pageInfo.nextCursor).toBe(
					null,
				);
				expect((yield* api.calls).map(({ name, request }) => ({ name, request }))).toEqual([
					{ name: "listLogs", request: { limit: 25, after: undefined } },
					{ name: "listLogs", request: { limit: 25, after: "log-cursor" } },
				]);
			}),
		);
	});

	layer(instanceAdminLayer())((test) => {
		test.effect("polls reset operations through the admin recipe and returns the result", () => {
			return Effect.gen(function* () {
				const api = yield* FakeInstanceAdminApi;
				const sessionId = yield* (yield* InstanceAdminSessionService).create(
					origin,
					"admin-secret",
				);
				const service = yield* InstanceAdminService;
				const fiber = yield* Effect.forkChild(service.resetUser(sessionId, "user-1"));

				yield* TestClock.adjust("2 seconds");

				expect(yield* Fiber.join(fiber)).toEqual(resetResult);
				expect(yield* api.lifecyclePolls).toBe(1);
				const calls = yield* api.calls;
				expect(calls.map(({ name }) => name)).toEqual(["resetUser", "query"]);
				expect(calls[1]?.document?.queries.operation).toMatchObject({
					from: { table: "userLifecycleOperation" },
				});
			});
		});
	});

	layer(instanceAdminLayer())((test) => {
		test.effect("fails before impersonation transport when the session is missing", () => {
			return Effect.gen(function* () {
				const service = yield* InstanceAdminService;
				const error = yield* Effect.flip(
					service.startUserImpersonation("missing-session", "user-1", authorization),
				);

				expect(error).toEqual(new InstanceAdminSessionNotFound({ sessionId: "missing-session" }));
				expect(yield* (yield* FakeInstanceAdminApi).calls).toEqual([]);
			});
		});
	});
});
