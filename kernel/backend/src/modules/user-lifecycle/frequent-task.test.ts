import { expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";

import { userLifecycleFrequentTask } from "./frequent-task";
import { UserLifecycleService } from "./service";

it.effect("reconciles pending lifecycle outbox rows on a frequent tick", () => {
	let limit: number | null = null;
	return userLifecycleFrequentTask.run({ executionId: "tick-1" }).pipe(
		Effect.provide(
			Layer.mergeAll(
				Layer.mock(UserLifecycleService)({
					reconcilePending: (value) => Effect.sync(() => void (limit = value)),
				}),
			),
		),
		Effect.map(() => expect(limit).toBe(100)),
	);
});

it.effect("keeps the frequent tick alive when reconciliation fails", () =>
	userLifecycleFrequentTask.run({ executionId: "tick-1" }).pipe(
		Effect.provide(
			Layer.mergeAll(
				Layer.mock(UserLifecycleService)({ reconcilePending: () => Effect.die("database down") }),
			),
		),
		Effect.exit,
		Effect.map((exit) => expect(exit._tag).toBe("Success")),
	),
);
