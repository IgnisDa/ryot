import { expect, it } from "@effect/vitest";
import { WorkflowEngine, WorkflowInstance } from "@effect/workflow/WorkflowEngine";
import { Effect, Layer } from "effect";

import { dbRunnerLayer, makeWorkflowActivityEngine } from "#lib/test-support/effect";
import { ImportsRepository } from "#modules/imports/repository";
import { FrequentCronWorkflow } from "#modules/scheduler/cron-workflow";

import { integrationsFrequentTask } from "./frequent-task";
import { IntegrationsService } from "./service";

it.effect("reconciles scheduled yank runs inside the frequent cron activity", () => {
	let called = false;

	const instance = WorkflowInstance.initial(FrequentCronWorkflow, "exec-int");
	const engine = makeWorkflowActivityEngine(instance);

	const layer = Layer.mergeAll(
		dbRunnerLayer,
		Layer.mock(ImportsRepository, { _tag: "ImportsRepository" }),
		Layer.mock(IntegrationsService, {
			reconcileScheduledYankRuns: () => {
				called = true;
				return Effect.void;
			},
			_tag: "IntegrationsService",
		}),
	);

	return integrationsFrequentTask.run({ executionId: "exec-int" }).pipe(
		Effect.provideService(WorkflowEngine, engine),
		Effect.provideService(WorkflowInstance, instance),
		Effect.provide(layer),
		Effect.map(() => {
			expect(called).toBe(true);
		}),
	);
});
