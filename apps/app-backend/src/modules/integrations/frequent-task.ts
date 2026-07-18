import { Effect } from "effect";
import { WorkflowEngine } from "effect/unstable/workflow/WorkflowEngine";

import type { CronTask } from "#modules/scheduler/types";

import { IntegrationReconciliationWorkflow } from "./reconciliation-workflow";

export type FrequentCronTask = CronTask<never, WorkflowEngine>;

export const integrationsFrequentTask: FrequentCronTask = {
	name: "integrations-reconcile",
	run: ({ executionId }) =>
		Effect.gen(function* () {
			const engine = yield* WorkflowEngine;
			const reconcileExecutionId = `${executionId}-integrations-reconcile`;
			yield* engine
				.execute(IntegrationReconciliationWorkflow, {
					discard: true,
					executionId: reconcileExecutionId,
					payload: { executionId: reconcileExecutionId },
				})
				.pipe(
					Effect.catchCause((cause) =>
						Effect.logError("integrations reconcile enqueue failed", cause),
					),
				);
		}),
};
