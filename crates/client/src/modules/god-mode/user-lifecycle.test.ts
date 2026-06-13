import { expect, it } from "@effect/vitest";
import { UserId } from "@ryot-app/contract/schema/brands";
import { Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";

import { type GodModeUserLifecycleOperation, runUserLifecycleOperation } from "./user-lifecycle";

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
	return () => Effect.sync(() => pending.shift() ?? operation("running"));
};

it.effect("polls a lifecycle operation until it completes", () =>
	Effect.gen(function* () {
		const completed = operation("completed", { finishedAt: "2026-08-24T00:00:04.000Z" });
		const fiber = yield* Effect.forkChild(
			runUserLifecycleOperation({
				start: Effect.succeed(operation("pending")),
				poll: scripted([operation("pending"), operation("running"), completed]),
			}),
		);

		yield* TestClock.adjust("4 seconds");

		expect(yield* Fiber.join(fiber)).toEqual(completed);
	}),
);

it.effect("returns a completed reset result without polling again", () =>
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
			start: Effect.succeed(completed),
			poll: () =>
				Effect.sync(() => {
					polls += 1;
					return completed;
				}),
		});

		expect(result.resetResult).toEqual(resetResult);
		expect(polls).toBe(0);
	}),
);

it.effect("fails immediately with the terminal operation details", () =>
	Effect.gen(function* () {
		let polls = 0;
		const failed = operation("failed", {
			finishedAt: "2026-08-24T00:00:00.000Z",
			failure: { code: "database-cleanup-failed" },
		});

		const result = yield* Effect.flip(
			runUserLifecycleOperation({
				start: Effect.succeed(failed),
				poll: () =>
					Effect.sync(() => {
						polls += 1;
						return failed;
					}),
			}),
		);

		expect(result).toEqual(failed);
		expect(polls).toBe(0);
	}),
);
