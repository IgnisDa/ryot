import { expect, it } from "@effect/vitest";
import { APIError } from "better-auth/api";
import type { Either } from "effect";
import { Effect } from "effect";
import { describe } from "vitest";

import { gateSessionCreation, type SessionGateDeps } from "./session-gate";

const completedAt = new Date("2026-01-01T00:00:00Z");
const disabledAt = new Date("2026-01-01T00:00:00Z");

function assertApiError(error: unknown): asserts error is APIError {
	if (!(error instanceof APIError)) {
		throw new Error(`Expected APIError, got ${typeof error}`);
	}
}

const makeMockDb = (row: { disabledAt: Date | null; bootstrapCompletedAt: Date | null }) =>
	Object.assign(Object.create(null), {
		select: () => ({
			from: () => ({
				where: () =>
					Object.assign(Promise.resolve([row]), {
						limit: () => Promise.resolve([row]),
					}),
			}),
		}),
	});

const makeDeps = (
	row: { disabledAt: Date | null; bootstrapCompletedAt: Date | null },
	runBootstrap: (userId: string) => Promise<void> = () => Promise.resolve(),
): SessionGateDeps => ({
	db: makeMockDb(row),
	runBootstrap,
});

const runGate = (deps: SessionGateDeps, userId: string) =>
	Effect.tryPromise({
		try: () => gateSessionCreation(deps, userId),
		catch: (error) => {
			assertApiError(error);
			return error;
		},
	}).pipe(Effect.either);

const extractError = (either: Either.Either<void, APIError>): APIError => {
	expect(either._tag).toBe("Left");
	if (either._tag === "Left") {
		return either.left;
	}
	throw new Error("Expected gate failure but gate succeeded");
};

describe("gateSessionCreation", () => {
	it.effect("resolves without calling runBootstrap when the marker is already set", () =>
		Effect.gen(function* () {
			let called = false;
			const deps = makeDeps({ disabledAt: null, bootstrapCompletedAt: completedAt }, () => {
				called = true;
				return Promise.resolve();
			});

			const either = yield* runGate(deps, "user-1");
			expect(either._tag).toBe("Right");
			expect(called).toBe(false);
		}),
	);

	it.effect("calls runBootstrap and resolves when the marker is null and bootstrap succeeds", () =>
		Effect.gen(function* () {
			let called = false;
			const deps = makeDeps({ disabledAt: null, bootstrapCompletedAt: null }, () => {
				called = true;
				return Promise.resolve();
			});

			const either = yield* runGate(deps, "user-1");
			expect(either._tag).toBe("Right");
			expect(called).toBe(true);
		}),
	);

	it.effect("throws USER_INITIALIZING (503) when the marker is null and bootstrap rejects", () =>
		Effect.gen(function* () {
			const deps = makeDeps({ disabledAt: null, bootstrapCompletedAt: null }, () =>
				Promise.reject(new Error("db down")),
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
				return Promise.resolve();
			});

			const either = yield* runGate(deps, "user-1");
			const error = extractError(either);
			expect(error.statusCode).toBe(403);
			expect(error.body?.code).toBe("USER_DISABLED");
			expect(called).toBe(false);
		}),
	);

	it.effect("resolves without calling runBootstrap when the user row is not found", () =>
		Effect.gen(function* () {
			let called = false;
			const deps: SessionGateDeps = {
				db: Object.assign(Object.create(null), {
					select: () => ({
						from: () => ({
							where: () =>
								Object.assign(Promise.resolve([]), {
									limit: () => Promise.resolve([]),
								}),
						}),
					}),
				}),
				runBootstrap: () => {
					called = true;
					return Promise.resolve();
				},
			};

			const either = yield* runGate(deps, "missing-user");
			expect(either._tag).toBe("Right");
			expect(called).toBe(false);
		}),
	);
});
