import { Effect } from "effect";
import { WorkflowEngine } from "effect/workflow/WorkflowEngine";

import { dispatchAdmittedWorkflow } from "#modules/mutations/workflow-dispatch";
import type { CronTask } from "#modules/scheduler/types";
import type { DatabaseSession } from "#platform/db/session";

import { IntegrationSyncWorkflow } from "./sync-workflow";

export type FrequentCronTask = CronTask<never, WorkflowEngine | DatabaseSession>;

export const integrationsFrequentTask: FrequentCronTask = {
	name: "integrations-sync",
	run: ({ executionId }) =>
		Effect.gen(function* () {
			const engine = yield* WorkflowEngine;
			const syncExecutionId = `${executionId}-integrations-sync`;
			yield* dispatchAdmittedWorkflow(engine, IntegrationSyncWorkflow, null, {
				discard: true,
				executionId: syncExecutionId,
				payload: { userId: null, accountGeneration: null, executionId: syncExecutionId },
			}).pipe(
				Effect.catchCause((cause) => Effect.logError("integrations sync enqueue failed", cause)),
			);
		}),
};
