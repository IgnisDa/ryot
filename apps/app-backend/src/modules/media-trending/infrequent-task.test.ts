import { expect, it } from "@effect/vitest";
import { WorkflowEngine, WorkflowInstance } from "@effect/workflow/WorkflowEngine";
import { Effect, Layer } from "effect";

import { makeWorkflowEngine } from "#lib/test-utils/effect";
import { InfrequentCronWorkflow } from "#modules/scheduler/cron-workflow";

import { mediaTrendingInfrequentTask } from "./infrequent-task";

it.effect("dispatches the trending refresh workflow with a tick-derived execution id", () => {
	const captured: Array<Parameters<WorkflowEngine["Type"]["execute"]>[1]> = [];
	const instance = WorkflowInstance.initial(InfrequentCronWorkflow, "cron-run");
	const engine = makeWorkflowEngine({
		execute: (_workflow, options) => {
			captured.push(options);
			return Effect.succeed(options.executionId);
		},
	});

	return mediaTrendingInfrequentTask.run({ executionId: "cron-run" }).pipe(
		Effect.provideService(WorkflowEngine, engine),
		Effect.provide(Layer.succeed(WorkflowInstance, instance)),
		Effect.map(() => {
			expect(captured).toMatchObject([
				{
					discard: true,
					executionId: "cron-run-media-trending",
					payload: { executionId: "cron-run-media-trending" },
				},
			]);
		}),
	);
});

it.effect("swallows a trending failure so it does not fail the cron tick", () => {
	const instance = WorkflowInstance.initial(InfrequentCronWorkflow, "cron-run");
	const engine = makeWorkflowEngine({
		execute: () => Effect.die("trending boom"),
	});

	return mediaTrendingInfrequentTask.run({ executionId: "cron-run" }).pipe(
		Effect.provideService(WorkflowEngine, engine),
		Effect.provide(Layer.succeed(WorkflowInstance, instance)),
		Effect.exit,
		Effect.map((exit) => {
			expect(exit._tag).toBe("Success");
		}),
	);
});
