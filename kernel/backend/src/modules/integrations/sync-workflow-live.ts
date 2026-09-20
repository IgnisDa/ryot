import { Effect, Schema } from "effect";
import { WorkflowEngine } from "effect/unstable/workflow/WorkflowEngine";

import { implementWorkflow, makeActivity } from "#lib/infrastructure/workflow-scope";
import { MutationReceipts } from "#modules/mutations/receipts";
import { admitWorkflow, dispatchAdmittedWorkflow } from "#modules/mutations/workflow-dispatch";

import { ProcessIntegrationRunWorkflow } from "./integration-workflow";
import { IntegrationSyncRun } from "./jobs";
import { IntegrationsService } from "./service";
import { type IntegrationSyncPayload, IntegrationSyncWorkflow } from "./sync-workflow";

export const runIntegrationSyncWorkflow = Effect.fn("IntegrationSyncWorkflow")(
	function* (payload: IntegrationSyncPayload, executionId: string) {
		yield* Effect.annotateCurrentSpan({ executionId, userId: payload.userId });
		const engine = yield* WorkflowEngine;
		const integrations = yield* IntegrationsService;
		const receipts = yield* MutationReceipts.make;
		yield* admitWorkflow(
			receipts,
			IntegrationSyncWorkflow,
			payload.accountGeneration,
			executionId,
		).pipe(Effect.orDie);

		const runs = yield* makeActivity({
			error: Schema.Never,
			name: "prepare-integration-sync-runs",
			success: Schema.Array(IntegrationSyncRun),
			execute: integrations
				.prepareYankRuns(payload.userId, payload.accountGeneration)
				.pipe(Effect.orDie),
		});

		for (const run of runs) {
			yield* dispatchAdmittedWorkflow(
				receipts,
				engine,
				ProcessIntegrationRunWorkflow,
				run.accountGeneration,
				{
					discard: true,
					executionId: run.runId,
					payload: {
						runId: run.runId,
						userId: run.userId,
						integrationId: run.integrationId,
						accountGeneration: run.accountGeneration,
					},
				},
				(admission) => admission.pipe(Effect.orDie),
				(execution) =>
					execution.pipe(
						Effect.catchCause((cause) =>
							Effect.logError("integration sync run dispatch failed", cause).pipe(
								Effect.annotateLogs({ runId: run.runId }),
								Effect.andThen(
									integrations
										.settleImportDispatchFailure({ runId: run.runId, userId: run.userId })
										.pipe(Effect.orDie),
								),
							),
						),
					),
			);
		}
	},
	(effect, payload, executionId) =>
		Effect.annotateLogs(effect, {
			executionId,
			userId: payload.userId,
			workflow: "IntegrationSyncWorkflow",
		}),
);

export const IntegrationSyncWorkflowDefinitionsLive = implementWorkflow(
	IntegrationSyncWorkflow,
	runIntegrationSyncWorkflow,
);
