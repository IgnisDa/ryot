import { BunServices } from "@effect/platform-bun";
import { expect, it } from "@effect/vitest";
import { AutomationWarning } from "@ryot-app/contract/modules/automations/lifecycle";
import { Clock, Duration, Effect, Layer, Schedule, Schema } from "effect";
import { Reactivity } from "effect/reactivity";
import { Workflow } from "effect/workflow";
import { WorkflowEngine } from "effect/workflow/WorkflowEngine";

import { LifecycleExecution } from "#lib/domain/lifecycle-execution";
import { DatabaseSession } from "#lib/infrastructure/db/session";
import { implementWorkflow } from "#lib/infrastructure/workflow-scope";
import { makeSqlClusterWorkflowEngine } from "#lib/test-utils/effect";

import { LifecycleExecutionLive } from "./execution";
import { triggerFixture } from "./lifecycle.test-support";
import {
	operationsLive,
	release,
	requiredRun,
	runControlLayer,
	runWorkflowLive,
} from "./required-hooks.test-support";

const trigger = triggerFixture();
const WaitingParent = Workflow.make("RequiredHooksClusterParent", {
	idempotencyKey: ({ id }) => id,
	success: Schema.Array(AutomationWarning),
	payload: { id: Schema.String, runIds: Schema.Array(Schema.String) },
});
const waitingParentLive = Layer.unwrap(
	Effect.map(LifecycleExecution, (service) =>
		implementWorkflow(WaitingParent, ({ runIds }) =>
			service
				.after({ triggerId: trigger.id, runs: runIds.map((id) => requiredRun(id, trigger.id)) })
				.pipe(Effect.orDie),
		),
	),
);

const awaitParent = (id: string, runIds: ReadonlyArray<string>) =>
	Effect.gen(function* () {
		const engine = yield* WorkflowEngine;
		const started = yield* Clock.currentTimeMillis;
		const warnings = yield* engine.execute(WaitingParent, {
			executionId: id,
			payload: { id, runIds },
			suspendedRetrySchedule: Schedule.spaced(Duration.millis(20)),
		});
		return { warnings, elapsedMs: (yield* Clock.currentTimeMillis) - started };
	});

it.layer(Layer.merge(BunServices.layer, Reactivity.layer), { excludeTestServices: true })(
	(test) => {
		test.effect("resumes a waiting workflow on the cluster engine when its hooks complete", () =>
			Effect.scoped(
				Effect.gen(function* () {
					const engineLayer = yield* makeSqlClusterWorkflowEngine();
					const context = yield* Layer.build(
						Layer.mergeAll(waitingParentLive, runWorkflowLive).pipe(
							Layer.provideMerge(
								LifecycleExecutionLive.pipe(Layer.provide(Layer.mock(DatabaseSession)({}))),
							),
							Layer.provideMerge(operationsLive),
							Layer.provideMerge(engineLayer),
							Layer.provideMerge(runControlLayer(1_200)),
						),
					);
					const [single, pair, late] = yield* Effect.all(
						[
							Effect.forkChild(Effect.delay(release("held-cluster"), "200 millis")).pipe(
								Effect.andThen(awaitParent("single", ["held-cluster"])),
							),
							Effect.forkChild(
								Effect.all([
									Effect.delay(release("held-pair-first"), "100 millis"),
									Effect.delay(release("held-pair-second"), "300 millis"),
								]),
							).pipe(Effect.andThen(awaitParent("pair", ["held-pair-first", "held-pair-second"]))),
							awaitParent("late", ["late-cluster"]),
						],
						{ concurrency: "unbounded" },
					).pipe(Effect.provideContext(context));
					expect([single.warnings, pair.warnings, late.warnings]).toEqual([[], [], []]);
					expect(single.elapsedMs).toBeLessThan(1_000);
					expect(pair.elapsedMs).toBeLessThan(1_000);
				}),
			),
		);
	},
);
