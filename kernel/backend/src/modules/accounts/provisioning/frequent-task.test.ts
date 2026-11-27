import { expect } from "bun:test";

import { testTimeout } from "@ryot-app/testing/test-timeout";
import { layer } from "@voila.dev/effect-bun-test";
import { Context, Effect, Layer, Ref } from "effect";

import { userBootstrapFrequentTask } from "./frequent-task";
import { UserBootstrapScheduling } from "./scheduling";

class RecordedReconcileLimit extends Context.Service<
	RecordedReconcileLimit,
	{ readonly limit: Effect.Effect<null | number> }
>()(
	"@ryot-app/kernel-backend/modules/accounts/provisioning/frequent-task.test/RecordedReconcileLimit",
) {}

const recordingSchedulingLayer = Layer.unwrap(
	Effect.gen(function* () {
		const limit = yield* Ref.make<null | number>(null);
		return Layer.merge(
			Layer.mock(UserBootstrapScheduling)({ reconcile: (value) => Ref.set(limit, value) }),
			Layer.succeed(RecordedReconcileLimit, { limit: Ref.get(limit) }),
		);
	}),
);

layer(recordingSchedulingLayer)((test) => {
	test.effect(
		"reconciles incomplete users on a frequent tick",
		() =>
			Effect.gen(function* () {
				yield* userBootstrapFrequentTask.run({ executionId: "tick-1" });
				expect(yield* (yield* RecordedReconcileLimit).limit).toBe(100);
			}),
		testTimeout,
	);
});

layer(Layer.mock(UserBootstrapScheduling)({ reconcile: () => Effect.die("database down") }))(
	(test) => {
		test.effect(
			"keeps the frequent tick alive when reconciliation fails",
			() =>
				userBootstrapFrequentTask.run({ executionId: "tick-1" }).pipe(
					Effect.exit,
					Effect.map((exit) => expect(exit._tag).toBe("Success")),
				),
			testTimeout,
		);
	},
);
