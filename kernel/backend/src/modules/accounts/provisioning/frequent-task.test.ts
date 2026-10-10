import { expect, layer } from "@effect/vitest";
import { Context, Effect, Layer, Ref } from "effect";

import { userBootstrapFrequentTask } from "./frequent-task";
import { UserBootstrapScheduling } from "./scheduling";

class RecordedReconcileLimit extends Context.Service<
	RecordedReconcileLimit,
	{ readonly limit: Effect.Effect<number | null> }
>()("test/RecordedReconcileLimit") {}

const recordingSchedulingLayer = Layer.unwrap(
	Effect.gen(function* () {
		const limit = yield* Ref.make<number | null>(null);
		return Layer.merge(
			Layer.mock(UserBootstrapScheduling)({ reconcile: (value) => Ref.set(limit, value) }),
			Layer.succeed(RecordedReconcileLimit, { limit: Ref.get(limit) }),
		);
	}),
);

layer(recordingSchedulingLayer)((test) => {
	test.effect("reconciles incomplete users on a frequent tick", () =>
		Effect.gen(function* () {
			yield* userBootstrapFrequentTask.run({ executionId: "tick-1" });
			expect(yield* (yield* RecordedReconcileLimit).limit).toBe(100);
		}),
	);
});

layer(Layer.mock(UserBootstrapScheduling)({ reconcile: () => Effect.die("database down") }))(
	(test) => {
		test.effect("keeps the frequent tick alive when reconciliation fails", () =>
			userBootstrapFrequentTask.run({ executionId: "tick-1" }).pipe(
				Effect.exit,
				Effect.map((exit) => expect(exit._tag).toBe("Success")),
			),
		);
	},
);
