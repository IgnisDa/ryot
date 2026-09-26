import { describe, expect, it } from "@effect/vitest";
import type { ContractSuccess } from "@ryot-app/contract/client";
import { UserId } from "@ryot-app/contract/schema/brands";
import type { PreparedRecipe } from "@ryot-app/ryotql";
import { Effect, Fiber, Layer, Result } from "effect";
import { TestClock } from "effect/testing";

import { decodeServerOrigin, type ServerOrigin } from "#/api/origin";
import { makeGodModeApi } from "#/api/ports.test-layer";
import { GodModeService, GodModeSessionNotFound } from "#/modules/god-mode/service";
import { GodModeSessionService, makeGodModeSessionService } from "#/modules/god-mode/session";
import type { GodModeUserLifecycleOperation } from "#/modules/god-mode/user-lifecycle";

const origin = decodeServerOrigin("https://ryot.example");
const otherOrigin = decodeServerOrigin("https://other.example");

const operation = (
	kind: GodModeUserLifecycleOperation["kind"],
	status: GodModeUserLifecycleOperation["status"],
	overrides: Partial<GodModeUserLifecycleOperation> = {},
): GodModeUserLifecycleOperation => ({
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

const makeLayer = () => {
	let nextSession = 0;
	const sessions = makeGodModeSessionService(() => `session-${++nextSession}`);
	const calls: Array<{
		readonly origin: ServerOrigin;
		readonly token: string;
		readonly document?: PreparedRecipe<unknown>["document"];
		readonly name: string;
		readonly request?: unknown;
	}> = [];
	let lifecyclePolls = 0;
	const resetResult = {
		email: "reader@example.com",
		userId: UserId.make("user-1"),
		resetUrl: "https://ryot.example/reset-password?token=reset-secret",
	};
	const record =
		<M extends "resetUser" | "deleteUser" | "resetUserPassword" | "setUserDisabled">(
			name: M,
			respond: () => ContractSuccess<"godMode", M>,
		) =>
		(requestedOrigin: ServerOrigin, token: string, request?: unknown) =>
			Effect.sync(() => {
				calls.push({ name, token, request, origin: requestedOrigin });
				return respond();
			});
	const godMode = makeGodModeApi({
		resetUser: record("resetUser", () => ({ operationId: "reset-operation" })),
		deleteUser: record("deleteUser", () => ({ operationId: "delete-operation" })),
		setUserDisabled: record("setUserDisabled", () => ({ id: UserId.make("user-1") })),
		resetUserPassword: record("resetUserPassword", () => ({
			email: resetResult.email,
			resetUrl: resetResult.resetUrl,
		})),
		query: (requestedOrigin, token, recipe) =>
			Effect.sync(() => {
				calls.push({ token, name: "query", origin: requestedOrigin, document: recipe.document });
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
					lifecyclePolls += 1;
					response = {
						data: {
							operation: page([
								calls.some(({ name }) => name === "deleteUser")
									? operation("delete", "completed")
									: operation("reset", "completed", { resetResult }),
							]),
						},
					};
				} else {
					throw new Error("Unexpected admin query");
				}
				return Result.getOrThrow(recipe.decode(response));
			}),
	});
	const session = Layer.succeed(GodModeSessionService, sessions);
	const layer = GodModeService.layer.pipe(Layer.provide(godMode), Layer.provide(session));

	return { calls, layer, sessions, resetResult, lifecyclePolls: () => lifecyclePolls };
};

describe("God Mode service", () => {
	it.effect("uses each session's admin origin and token for cursor reads and writes", () => {
		const fixture = makeLayer();
		return Effect.gen(function* () {
			const sessionId = yield* fixture.sessions.create(origin, "admin-secret");
			const service = yield* GodModeService;

			const users = yield* service.listUsers(sessionId, "reader", undefined, 25);
			expect(users).toMatchObject({ total: 1, items: [{ email: "reader@example.com" }] });
			expect((yield* service.listUsers(sessionId, "reader", "cursor-2", 25)).total).toBe(1);
			expect(yield* service.getMigrationReport(sessionId, "report-cursor")).toMatchObject({
				items: [],
				pageInfo: { nextCursor: null },
			});
			expect(yield* service.resetUserPassword(sessionId, "user-1")).toEqual({
				email: fixture.resetResult.email,
				resetUrl: fixture.resetResult.resetUrl,
			});
			expect(yield* service.setUserDisabled(sessionId, "user-1", true)).toMatchObject({
				id: "user-1",
			});
			expect((yield* service.deleteUser(sessionId, "user-1")).status).toBe("completed");

			expect(fixture.calls[6]?.document?.queries.operation).toMatchObject({
				from: { table: "userLifecycleOperation" },
			});
			const otherSessionId = yield* fixture.sessions.create(otherOrigin, "other-secret");
			expect((yield* service.listUsers(otherSessionId, "", undefined, 50)).total).toBe(1);
			expect(
				fixture.calls.map(({ token, origin: requestedOrigin }) => ({
					token,
					origin: requestedOrigin,
				})),
			).toEqual([
				...Array.from({ length: 7 }, () => ({ origin, token: "admin-secret" })),
				{ origin: otherOrigin, token: "other-secret" },
			]);
			expect(fixture.calls[0]?.document?.queries.users).toMatchObject({
				output: { pagination: { limit: 25 } },
			});
			expect(fixture.calls[1]?.document?.queries.users).toMatchObject({
				output: { pagination: { limit: 25, after: "cursor-2" } },
			});
			expect(fixture.calls[2]?.document?.queries.entries).toMatchObject({
				output: { pagination: { limit: 50, after: "report-cursor" } },
			});
			expect(fixture.calls.slice(3, 7).map(({ name, request }) => ({ name, request }))).toEqual([
				{ name: "resetUserPassword", request: { params: { userId: "user-1" } } },
				{
					name: "setUserDisabled",
					request: { payload: { disabled: true }, params: { userId: "user-1" } },
				},
				{ name: "deleteUser", request: { params: { userId: "user-1" } } },
				{ name: "query", request: undefined },
			]);
		}).pipe(Effect.provide(fixture.layer));
	});

	it.effect("polls reset operations through the admin recipe and returns the result", () => {
		const fixture = makeLayer();
		return Effect.gen(function* () {
			const sessionId = yield* fixture.sessions.create(origin, "admin-secret");
			const service = yield* GodModeService;
			const fiber = yield* Effect.forkChild(service.resetUser(sessionId, "user-1"));

			yield* TestClock.adjust("2 seconds");

			expect(yield* Fiber.join(fiber)).toEqual(fixture.resetResult);
			expect(fixture.lifecyclePolls()).toBe(1);
			expect(fixture.calls.map(({ name }) => name)).toEqual(["resetUser", "query"]);
			expect(fixture.calls[1]?.document?.queries.operation).toMatchObject({
				from: { table: "userLifecycleOperation" },
			});
		}).pipe(Effect.provide(fixture.layer));
	});

	it.effect("fails before transport when the session is missing", () => {
		const fixture = makeLayer();
		return Effect.gen(function* () {
			const service = yield* GodModeService;
			const error = yield* Effect.flip(service.getMigrationReport("missing-session"));

			expect(error).toEqual(new GodModeSessionNotFound({ sessionId: "missing-session" }));
			expect(fixture.calls).toEqual([]);
		}).pipe(Effect.provide(fixture.layer));
	});
});
