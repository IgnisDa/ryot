import { expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { WorkflowEngine, WorkflowInstance } from "effect/unstable/workflow/WorkflowEngine";

import { makeWorkflowEngine } from "#lib/test-utils/effect";
import { FrequentCronWorkflow } from "#modules/scheduler/cron-workflow";

import { integrationsFrequentTask } from "./frequent-task";

it.effect("dispatches the reconciliation workflow with a tick-derived execution id", () => {
	const captured: Array<Parameters<WorkflowEngine["Service"]["execute"]>[1]> = [];
	const instance = WorkflowInstance.initial(FrequentCronWorkflow, "exec-int");
	const engine = makeWorkflowEngine({
		execute: (_workflow, options) => {
			captured.push(options);
			return Effect.succeed(options.executionId);
		},
	});

	return integrationsFrequentTask.run({ executionId: "exec-int" }).pipe(
		Effect.provideService(WorkflowEngine, engine),
		Effect.provide(Layer.succeed(WorkflowInstance, instance)),
		Effect.map(() => {
			expect(captured).toMatchObject([
				{
					discard: true,
					executionId: "exec-int-integrations-reconcile",
					payload: { executionId: "exec-int-integrations-reconcile" },
				},
			]);
		}),
	);
});

it.effect("swallows an enqueue failure so the cron tick keeps running", () => {
	const instance = WorkflowInstance.initial(FrequentCronWorkflow, "exec-int");
	const engine = makeWorkflowEngine({
		execute: () => Effect.die("enqueue boom"),
	});

	return integrationsFrequentTask.run({ executionId: "exec-int" }).pipe(
		Effect.provideService(WorkflowEngine, engine),
		Effect.provide(Layer.succeed(WorkflowInstance, instance)),
		Effect.exit,
		Effect.map((exit) => {
			expect(exit._tag).toBe("Success");
		}),
	);
});
