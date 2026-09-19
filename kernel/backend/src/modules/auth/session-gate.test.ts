import { expect, layer } from "@effect/vitest";
import { APIError } from "better-auth/api";
import type { Result } from "effect";
import { Effect, Layer } from "effect";
import { describe } from "vitest";

import { fakeDatabaseSession } from "#lib/test-utils/effect";

import { LifecycleWriteGuard } from "./lifecycle-write-guard";
import { SessionCreationGate } from "./session-gate";

const disabledAt = new Date("2026-01-01T00:00:00Z");

function assertApiError(error: unknown): asserts error is APIError {
	if (!(error instanceof APIError)) {
		throw new Error(`Expected APIError, got ${typeof error}`);
	}
}

type UserRow = { disabledAt: Date | null };

const gateLayer = (rows: ReadonlyArray<UserRow>, active = false) => {
	const database = Object.assign(Object.create(null), {
		select: () => ({ from: () => ({ where: () => ({ limit: () => Effect.succeed(rows) }) }) }),
	});
	return SessionCreationGate.layer.pipe(
		Layer.provide(
			Layer.merge(
				fakeDatabaseSession(database),
				Layer.mock(LifecycleWriteGuard)({ isActive: () => Effect.succeed(active) }),
			),
		),
	);
};

const runGate = (userId: string) =>
	Effect.flatMap(SessionCreationGate, (sessionGate) =>
		sessionGate.gate(userId).pipe(Effect.result),
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
	layer(gateLayer([{ disabledAt: null }]))((test) => {
		test.effect("resolves when the user is enabled", () =>
			Effect.gen(function* () {
				const either = yield* runGate("user-1");
				expect(either._tag).toBe("Success");
			}),
		);
	});

	layer(gateLayer([{ disabledAt }]))((test) => {
		test.effect("throws USER_DISABLED (403) when the user is disabled", () =>
			Effect.gen(function* () {
				const either = yield* runGate("user-1");
				const error = extractError(either);
				expect(error.statusCode).toBe(403);
				expect(error.body?.code).toBe("USER_DISABLED");
			}),
		);
	});

	layer(gateLayer([], true))((test) => {
		test.effect("throws USER_LIFECYCLE_ACTIVE before creating a session", () =>
			Effect.gen(function* () {
				const error = extractError(yield* runGate("user-1"));
				expect(error.statusCode).toBe(403);
				expect(error.body?.code).toBe("USER_LIFECYCLE_ACTIVE");
			}),
		);
	});

	layer(gateLayer([]))((test) => {
		test.effect("resolves when the user row is not found", () =>
			Effect.gen(function* () {
				const either = yield* runGate("missing-user");
				expect(either._tag).toBe("Success");
			}),
		);
	});
});
