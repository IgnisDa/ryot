import { BunServices } from "@effect/platform-bun";
import { expect, it } from "@effect/vitest";
import { AutomationRunId } from "@ryot-app/contract/schema/brands";
import { Clock, Duration, Effect, Layer, Schedule } from "effect";
import { Reactivity } from "effect/reactivity";
import { WorkflowEngine } from "effect/workflow/WorkflowEngine";

import { makeSqlClusterWorkflowEngine } from "#lib/test-utils/effect";

import { AutomationObservationWorkflowDefinitionsLive } from "./execution";
import {
	operationsLive,
	release,
	runControlLayer,
	runWorkflowLive,
} from "./observation.test-support";
import { AutomationObservationWorkflow, automationObservationExecutionId } from "./run-workflow";

const observeOnCluster = (runId: string, deadlineInMs: number) =>
	Effect.gen(function* () {
		const engine = yield* WorkflowEngine;
		const started = yield* Clock.currentTimeMillis;
		const observed = yield* engine.execute(AutomationObservationWorkflow, {
			suspendedRetrySchedule: Schedule.spaced(Duration.millis(20)),
			executionId: automationObservationExecutionId(AutomationRunId.make(runId), 1),
			payload: {
				attemptNumber: 1,
				acceptedPatches: [],
				deadline: started + deadlineInMs,
				runId: AutomationRunId.make(runId),
			},
		});
		return { tag: observed._tag, elapsedMs: (yield* Clock.currentTimeMillis) - started };
	});

it.layer(Layer.merge(BunServices.layer, Reactivity.layer), { excludeTestServices: true })(
	(test) => {
		test.effect(
			"decides observations on the cluster engine from the run's exit, its deadline, and its attempt",
			() =>
				Effect.scoped(
					Effect.gen(function* () {
						const engineLayer = yield* makeSqlClusterWorkflowEngine();
						const context = yield* Layer.build(
							Layer.mergeAll(runWorkflowLive, AutomationObservationWorkflowDefinitionsLive).pipe(
								Layer.provideMerge(operationsLive),
								Layer.provideMerge(engineLayer),
								Layer.provideMerge(runControlLayer(1_200)),
							),
						);
						const [released, expired, late] = yield* Effect.all(
							[
								Effect.forkChild(Effect.delay(release("held-cluster"), "200 millis")).pipe(
									Effect.andThen(observeOnCluster("held-cluster", 5_000)),
								),
								observeOnCluster("held-expires", 500),
								observeOnCluster("late-cluster", 500),
							],
							{ concurrency: "unbounded" },
						).pipe(Effect.provideContext(context));
						expect(released.tag).toBe("completed");
						expect(released.elapsedMs).toBeLessThan(1_000);
						expect(expired.tag).toBe("expired");
						expect(late.tag).toBe("completed");
					}),
				),
		);
	},
);
