import { expect, it } from "@effect/vitest";
import { APIError } from "better-auth/api";
import type { Result } from "effect";
import { Effect } from "effect";
import { describe } from "vitest";

import { Database } from "#lib/infrastructure/db/service";

import { gateSessionCreation } from "./session-gate";

const completedAt = new Date("2026-01-01T00:00:00Z");
const disabledAt = new Date("2026-01-01T00:00:00Z");

function assertApiError(error: unknown): asserts error is APIError {
	if (!(error instanceof APIError)) {
		throw new Error(`Expected APIError, got ${typeof error}`);
	}
}

const makeMockDb = (
	rows: ReadonlyArray<{ disabledAt: Date | null; bootstrapCompletedAt: Date | null }>,
	active = false,
) => {
	let selection = 0;
	return Database.of(
		Object.assign(Object.create(null), {
			select: () => ({
				from: () => ({
					where: () => ({
						limit: () => {
							const activeRows = active ? [{ id: "op-1" }] : [];
							const selected = selection++ === 0 ? activeRows : rows;
							return Effect.succeed(selected);
						},
					}),
				}),
			}),
		}),
	);
};

const makeDeps = (
	row: { disabledAt: Date | null; bootstrapCompletedAt: Date | null },
	runBootstrap: (userId: string) => Effect.Effect<void, unknown> = () => Effect.void,
) => [makeMockDb([row]), runBootstrap] as const;

const runGate = (deps: ReturnType<typeof makeDeps>, userId: string) =>
	gateSessionCreation(userId, deps[1]).pipe(
		Effect.provideService(Database, deps[0]),
		Effect.result,
	);

const extractError = (either: Result.Result<void, unknown>) => {
	expect(either._tag).toBe("Failure");
	if (either._tag === "Failure") {
		assertApiError(either.failure);
		return either.failure;
	}
	throw new Error("Expected gate failure but gate succeeded");
};

describe("gateSessionCreation", () => {
	it.effect("resolves without calling runBootstrap when the marker is already set", () =>
		Effect.gen(function* () {
			let called = false;
			const deps = makeDeps({ disabledAt: null, bootstrapCompletedAt: completedAt }, () => {
				called = true;
				return Effect.void;
			});

			const either = yield* runGate(deps, "user-1");
			expect(either._tag).toBe("Success");
			expect(called).toBe(false);
		}),
	);

	it.effect("calls runBootstrap and resolves when the marker is null and bootstrap succeeds", () =>
		Effect.gen(function* () {
			let called = false;
			const deps = makeDeps({ disabledAt: null, bootstrapCompletedAt: null }, () => {
				called = true;
				return Effect.void;
			});

			const either = yield* runGate(deps, "user-1");
			expect(either._tag).toBe("Success");
			expect(called).toBe(true);
		}),
	);

	it.effect("throws USER_INITIALIZING (503) when the marker is null and bootstrap rejects", () =>
		Effect.gen(function* () {
			const deps = makeDeps({ disabledAt: null, bootstrapCompletedAt: null }, () =>
				Effect.fail("db down"),
			);

			const either = yield* runGate(deps, "user-1");
			const error = extractError(either);
			expect(error.statusCode).toBe(503);
			expect(error.body?.code).toBe("USER_INITIALIZING");
		}),
	);

	it.effect("throws USER_DISABLED (403) when disabledAt is set, regardless of marker state", () =>
		Effect.gen(function* () {
			let called = false;
			const deps = makeDeps({ disabledAt, bootstrapCompletedAt: null }, () => {
				called = true;
				return Effect.void;
			});

			const either = yield* runGate(deps, "user-1");
			const error = extractError(either);
			expect(error.statusCode).toBe(403);
			expect(error.body?.code).toBe("USER_DISABLED");
			expect(called).toBe(false);
		}),
	);

	it.effect("throws USER_LIFECYCLE_ACTIVE before creating a session", () =>
		Effect.gen(function* () {
			const deps = [makeMockDb([], true), () => Effect.void] as const;
			const error = extractError(yield* runGate(deps, "user-1"));
			expect(error.statusCode).toBe(403);
			expect(error.body?.code).toBe("USER_LIFECYCLE_ACTIVE");
		}),
	);

	it.effect("resolves without calling runBootstrap when the user row is not found", () =>
		Effect.gen(function* () {
			let called = false;
			const deps = [
				makeMockDb([]),
				() => {
					called = true;
					return Effect.void;
				},
			] as const;

			const either = yield* runGate(deps, "missing-user");
			expect(either._tag).toBe("Success");
			expect(called).toBe(false);
		}),
	);
});
