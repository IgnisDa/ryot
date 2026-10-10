import { expect, it } from "@effect/vitest";
import { UserId } from "@ryot-app/contract/schema/brands";
import { Effect, Fiber, Option } from "effect";
import { TestClock } from "effect/testing";

import {
	GodModeOperationNotFound,
	type GodModeUserLifecycleOperation,
	runUserLifecycleOperation,
} from "#/modules/god-mode/user-lifecycle";

const operation = (
	status: GodModeUserLifecycleOperation["status"],
	overrides: Partial<GodModeUserLifecycleOperation> = {},
): GodModeUserLifecycleOperation => ({
	status,
	failure: null,
	kind: "delete",
	startedAt: null,
	finishedAt: null,
	resetResult: null,
	id: "operation-1",
	userId: UserId.make("user-1"),
	createdAt: "2026-08-24T00:00:00.000Z",
	...overrides,
});

const scripted = (operations: readonly GodModeUserLifecycleOperation[]) => {
	const pending = [...operations];
	return () => Effect.sync(() => Option.some(pending.shift() ?? operation("running")));
};

it.effect("polls the admin operation every two seconds until it completes", () =>
	Effect.gen(function* () {
		const completed = operation("completed", { finishedAt: "2026-08-24T00:00:04.000Z" });
		const fiber = yield* Effect.forkChild(
			runUserLifecycleOperation({
				start: Effect.succeed({ operationId: "operation-1" }),
				poll: scripted([operation("pending"), operation("running"), completed]),
			}),
		);

		yield* TestClock.adjust("4 seconds");

		expect(yield* Fiber.join(fiber)).toEqual(completed);
	}),
);

it.effect(
	"reads a completed reset result from the admin recipe even when the command just returned",
	() =>
		Effect.gen(function* () {
			let polls = 0;
			const resetResult = {
				email: "reader@example.com",
				userId: UserId.make("user-1"),
				resetUrl: "https://example.com/reset-password?token=secret",
			} satisfies NonNullable<GodModeUserLifecycleOperation["resetResult"]>;
			const completed = operation("completed", {
				resetResult,
				kind: "reset",
				finishedAt: "2026-08-24T00:00:00.000Z",
			});

			const result = yield* runUserLifecycleOperation({
				start: Effect.succeed({ operationId: "operation-1" }),
				poll: () =>
					Effect.sync(() => {
						polls += 1;
						return Option.some(completed);
					}),
			});

			expect(result.resetResult).toEqual(resetResult);
			expect(polls).toBe(1);
		}),
);

it.effect("fails with the missing operation id instead of retrying an absent row", () =>
	Effect.gen(function* () {
		let polls = 0;
		const error = yield* Effect.flip(
			runUserLifecycleOperation({
				start: Effect.succeed({ operationId: "operation-1" }),
				poll: () =>
					Effect.sync(() => {
						polls += 1;
						return Option.none();
					}),
			}),
		);

		expect(error).toEqual(new GodModeOperationNotFound({ operationId: "operation-1" }));
		expect(polls).toBe(1);
	}),
);

it.effect("fails with terminal operation details from the admin recipe", () =>
	Effect.gen(function* () {
		let polls = 0;
		const failed = operation("failed", {
			finishedAt: "2026-08-24T00:00:00.000Z",
			failure: { code: "database-cleanup-failed" },
		});

		const result = yield* Effect.flip(
			runUserLifecycleOperation({
				start: Effect.succeed({ operationId: "operation-1" }),
				poll: () =>
					Effect.sync(() => {
						polls += 1;
						return Option.some(failed);
					}),
			}),
		);

		expect(result).toEqual(failed);
		expect(polls).toBe(1);
	}),
);
