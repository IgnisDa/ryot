import { Effect } from "effect";
import { WorkflowEngine } from "effect/unstable/workflow/WorkflowEngine";

import type { DatabaseSession } from "#lib/infrastructure/db/session";
import { MutationReceipts } from "#modules/mutations/receipts";
import { dispatchAdmittedWorkflow } from "#modules/mutations/workflow-dispatch";
import type { CronTask } from "#modules/scheduler/types";

import { IntegrationSyncWorkflow } from "./sync-workflow";

export type FrequentCronTask = CronTask<never, WorkflowEngine | DatabaseSession>;

export const integrationsFrequentTask: FrequentCronTask = {
	name: "integrations-sync",
	run: ({ executionId }) =>
		Effect.gen(function* () {
			const engine = yield* WorkflowEngine;
			const receipts = yield* MutationReceipts.make;
			const syncExecutionId = `${executionId}-integrations-sync`;
			yield* dispatchAdmittedWorkflow(
				receipts,
				engine,
				IntegrationSyncWorkflow,
				null,
				{
					discard: true,
					executionId: syncExecutionId,
					payload: { userId: null, accountGeneration: null, executionId: syncExecutionId },
				},
				(admission) => admission,
				(dispatch) => dispatch,
			).pipe(
				Effect.catchCause((cause) => Effect.logError("integrations sync enqueue failed", cause)),
			);
		}),
};
