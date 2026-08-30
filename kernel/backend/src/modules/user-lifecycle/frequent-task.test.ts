import { expect, layer } from "@effect/vitest";
import { Context, Effect, Layer, Ref } from "effect";

import { userLifecycleFrequentTask } from "./frequent-task";
import { UserLifecycleService } from "./service";

class RecordedReconcileLimit extends Context.Service<
	RecordedReconcileLimit,
	{ readonly limit: Effect.Effect<number | null> }
>()("test/RecordedReconcileLimit") {}

const recordingLifecycleLayer = Layer.unwrap(
	Effect.gen(function* () {
		const limit = yield* Ref.make<number | null>(null);
		return Layer.merge(
			Layer.mock(UserLifecycleService)({ reconcilePending: (value) => Ref.set(limit, value) }),
			Layer.succeed(RecordedReconcileLimit, { limit: Ref.get(limit) }),
		);
	}),
);

layer(recordingLifecycleLayer)((test) => {
	test.effect("reconciles pending lifecycle outbox rows on a frequent tick", () =>
		Effect.gen(function* () {
			yield* userLifecycleFrequentTask.run({ executionId: "tick-1" });
			expect(yield* (yield* RecordedReconcileLimit).limit).toBe(100);
		}),
	);
});

layer(Layer.mock(UserLifecycleService)({ reconcilePending: () => Effect.die("database down") }))(
	(test) => {
		test.effect("keeps the frequent tick alive when reconciliation fails", () =>
			userLifecycleFrequentTask.run({ executionId: "tick-1" }).pipe(
				Effect.exit,
				Effect.map((exit) => expect(exit._tag).toBe("Success")),
			),
		);
	},
);
