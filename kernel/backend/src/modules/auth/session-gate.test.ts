import { expect, layer } from "@effect/vitest";
import { APIError } from "better-auth/api";
import type { Result } from "effect";
import { Effect, Layer, Ref } from "effect";
import { describe } from "vitest";

import { DatabaseSession } from "#lib/infrastructure/db/session";

import { gateSessionCreation } from "./session-gate";

const completedAt = new Date("2026-01-01T00:00:00Z");
const disabledAt = new Date("2026-01-01T00:00:00Z");

function assertApiError(error: unknown): asserts error is APIError {
	if (!(error instanceof APIError)) {
		throw new Error(`Expected APIError, got ${typeof error}`);
	}
}

type UserRow = { disabledAt: Date | null; bootstrapCompletedAt: Date | null };

const mockDatabaseLayer = (rows: ReadonlyArray<UserRow>, active = false) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const selection = yield* Ref.make(0);
			const activeRows = active ? [{ id: "op-1" }] : [];
			const database = Object.assign(Object.create(null), {
				select: () => ({
					from: () => ({
						where: () => ({
							limit: () =>
								Effect.map(
									Ref.getAndUpdate(selection, (count) => count + 1),
									(count) => (count === 0 ? activeRows : rows),
								),
						}),
					}),
				}),
			});
			return Layer.mock(DatabaseSession)({ current: Effect.succeed(database) });
		}),
	);

const runGate = (
	userId: string,
	runBootstrap: (userId: string) => Effect.Effect<void, unknown> = () => Effect.void,
) => gateSessionCreation(userId, runBootstrap).pipe(Effect.result);

const extractError = (either: Result.Result<void, unknown>) => {
	expect(either._tag).toBe("Failure");
	if (either._tag === "Failure") {
		assertApiError(either.failure);
		return either.failure;
	}
	throw new Error("Expected gate failure but gate succeeded");
};

describe("gateSessionCreation", () => {
	layer(mockDatabaseLayer([{ disabledAt: null, bootstrapCompletedAt: completedAt }]))((test) => {
		test.effect("resolves without calling runBootstrap when the marker is already set", () =>
			Effect.gen(function* () {
				let called = false;
				const either = yield* runGate("user-1", () => {
					called = true;
					return Effect.void;
				});
				expect(either._tag).toBe("Success");
				expect(called).toBe(false);
			}),
		);
	});

	layer(mockDatabaseLayer([{ disabledAt: null, bootstrapCompletedAt: null }]))((test) => {
		test.effect(
			"calls runBootstrap and resolves when the marker is null and bootstrap succeeds",
			() =>
				Effect.gen(function* () {
					let called = false;
					const either = yield* runGate("user-1", () => {
						called = true;
						return Effect.void;
					});
					expect(either._tag).toBe("Success");
					expect(called).toBe(true);
				}),
		);
	});

	layer(mockDatabaseLayer([{ disabledAt: null, bootstrapCompletedAt: null }]))((test) => {
		test.effect(
			"throws USER_INITIALIZING (503) when the marker is null and bootstrap rejects",
			() =>
				Effect.gen(function* () {
					const either = yield* runGate("user-1", () => Effect.fail("db down"));
					const error = extractError(either);
					expect(error.statusCode).toBe(503);
					expect(error.body?.code).toBe("USER_INITIALIZING");
				}),
		);
	});

	layer(mockDatabaseLayer([{ disabledAt, bootstrapCompletedAt: null }]))((test) => {
		test.effect(
			"throws USER_DISABLED (403) when disabledAt is set, regardless of marker state",
			() =>
				Effect.gen(function* () {
					let called = false;
					const either = yield* runGate("user-1", () => {
						called = true;
						return Effect.void;
					});
					const error = extractError(either);
					expect(error.statusCode).toBe(403);
					expect(error.body?.code).toBe("USER_DISABLED");
					expect(called).toBe(false);
				}),
		);
	});

	layer(mockDatabaseLayer([], true))((test) => {
		test.effect("throws USER_LIFECYCLE_ACTIVE before creating a session", () =>
			Effect.gen(function* () {
				const error = extractError(yield* runGate("user-1"));
				expect(error.statusCode).toBe(403);
				expect(error.body?.code).toBe("USER_LIFECYCLE_ACTIVE");
			}),
		);
	});

	layer(mockDatabaseLayer([]))((test) => {
		test.effect("resolves without calling runBootstrap when the user row is not found", () =>
			Effect.gen(function* () {
				let called = false;
				const either = yield* runGate("missing-user", () => {
					called = true;
					return Effect.void;
				});
				expect(either._tag).toBe("Success");
				expect(called).toBe(false);
			}),
		);
	});
});
