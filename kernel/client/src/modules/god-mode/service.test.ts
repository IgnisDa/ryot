import { describe, expect, it } from "@effect/vitest";
import type { ContractSuccess } from "@ryot-app/contract/client";
import { UserId } from "@ryot-app/contract/schema/brands";
import { Effect, Fiber, Layer } from "effect";
import { TestClock } from "effect/testing";

import type { GodModeApi } from "#/api/god-mode";
import { decodeServerOrigin, type ServerOrigin } from "#/api/origin";
import { makeGodModeApi } from "#/api/ports.test-layer";
import { GodModeService, GodModeSessionNotFound } from "#/modules/god-mode/service";
import { GodModeSessionService, makeGodModeSessionService } from "#/modules/god-mode/session";
import type { GodModeUserLifecycleOperation } from "#/modules/god-mode/user-lifecycle";

const origin = decodeServerOrigin("https://ryot.example");

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

const makeLayer = () => {
	const sessions = makeGodModeSessionService(() => "session-1");
	const calls: Array<{ readonly origin: string; readonly token: string }> = [];
	const requests: Array<{ readonly name: string; readonly request?: unknown }> = [];
	let lifecyclePolls = 0;
	const resetResult = {
		email: "reader@example.com",
		userId: UserId.make("user-1"),
		resetUrl: "https://ryot.example/reset-password?token=reset-secret",
	};
	const record =
		<M extends keyof GodModeApi["Service"]>(
			name: M,
			respond: () => ContractSuccess<"godMode", M>,
		) =>
		(requestedOrigin: ServerOrigin, token: string, request?: unknown) =>
			Effect.sync(() => {
				calls.push({ token, origin: requestedOrigin });
				requests.push({ name, request });
				return respond();
			});
	const godMode = makeGodModeApi({
		getMigrationReport: record("getMigrationReport", () => ({ entries: [] })),
		deleteUser: record("deleteUser", () => operation("delete", "completed")),
		resetUser: record("resetUser", () => operation("reset", "pending")),
		resetUserPassword: record("resetUserPassword", () => ({
			email: resetResult.email,
			resetUrl: resetResult.resetUrl,
		})),
		setUserDisabled: record("setUserDisabled", () => ({
			id: UserId.make("user-1"),
			disabledAt: "2026-09-01T01:00:00.000Z",
		})),
		getUserLifecycleOperation: record("getUserLifecycleOperation", () => {
			lifecyclePolls += 1;
			return operation("reset", "completed", { resetResult });
		}),
		listUsers: record("listUsers", () => ({
			total: 1,
			users: [
				{
					name: "Reader",
					disabledAt: null,
					twoFactorEnabled: false,
					email: "reader@example.com",
					id: UserId.make("user-1"),
					authState: "credential" as const,
					createdAt: "2026-09-01T00:00:00.000Z",
				},
			],
		})),
	});
	const session = Layer.succeed(GodModeSessionService, sessions);
	const layer = GodModeService.layer.pipe(Layer.provide(godMode), Layer.provide(session));

	return { calls, layer, requests, sessions, lifecyclePolls: () => lifecyclePolls, resetResult };
};

describe("God Mode service", () => {
	it.effect("resolves the opaque session and constructs typed contract requests", () => {
		const fixture = makeLayer();
		return Effect.gen(function* () {
			const sessionId = yield* fixture.sessions.create(origin, "admin-secret");
			const service = yield* GodModeService;

			expect(yield* service.listUsers(sessionId, "reader", 10, 25)).toMatchObject({ total: 1 });
			expect(yield* service.getMigrationReport(sessionId)).toEqual({ entries: [] });
			expect(yield* service.resetUserPassword(sessionId, "user-1")).toEqual({
				email: fixture.resetResult.email,
				resetUrl: fixture.resetResult.resetUrl,
			});
			expect(yield* service.setUserDisabled(sessionId, "user-1", true)).toMatchObject({
				id: "user-1",
			});
			expect((yield* service.deleteUser(sessionId, "user-1")).status).toBe("completed");

			expect(fixture.calls).toHaveLength(5);
			expect(fixture.calls.every((call) => call.token === "admin-secret")).toBe(true);
			expect(fixture.requests).toEqual([
				{ name: "listUsers", request: { query: { search: "reader", offset: 10, limit: 25 } } },
				{ name: "getMigrationReport" },
				{ name: "resetUserPassword", request: { params: { userId: "user-1" } } },
				{
					name: "setUserDisabled",
					request: { params: { userId: "user-1" }, payload: { disabled: true } },
				},
				{ name: "deleteUser", request: { params: { userId: "user-1" } } },
			]);
		}).pipe(Effect.provide(fixture.layer));
	});

	it.effect("polls reset operations and returns the completed reset result", () => {
		const fixture = makeLayer();
		return Effect.gen(function* () {
			const sessionId = yield* fixture.sessions.create(origin, "admin-secret");
			const service = yield* GodModeService;
			const fiber = yield* Effect.forkChild(service.resetUser(sessionId, "user-1"));

			yield* TestClock.adjust("2 seconds");

			expect(yield* Fiber.join(fiber)).toEqual(fixture.resetResult);
			expect(fixture.lifecyclePolls()).toBe(1);
			expect(fixture.calls).toHaveLength(2);
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
