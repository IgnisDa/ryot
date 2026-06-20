import { Effect } from "effect";
import { WorkflowEngine } from "effect/unstable/workflow/WorkflowEngine";

import type { CronTask } from "#modules/scheduler/types";

import { IntegrationSyncWorkflow } from "./sync-workflow";

export type FrequentCronTask = CronTask<never, WorkflowEngine>;

export const integrationsFrequentTask: FrequentCronTask = {
	name: "integrations-sync",
	run: ({ executionId }) =>
		Effect.gen(function* () {
			const engine = yield* WorkflowEngine;
			const syncExecutionId = `${executionId}-integrations-sync`;
			yield* engine
				.execute(IntegrationSyncWorkflow, {
					discard: true,
					executionId: syncExecutionId,
					payload: { userId: null, executionId: syncExecutionId },
				})
				.pipe(
					Effect.catchCause((cause) => Effect.logError("integrations sync enqueue failed", cause)),
				);
		}),
};
