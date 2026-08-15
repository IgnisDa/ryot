import { Effect, Schema } from "effect";
import { Activity } from "effect/unstable/workflow";
import { WorkflowEngine } from "effect/unstable/workflow/WorkflowEngine";

import { ProcessIntegrationRunWorkflow } from "./integration-workflow";
import { IntegrationSyncRun } from "./jobs";
import { IntegrationsService } from "./service";
import { type IntegrationSyncPayload, IntegrationSyncWorkflow } from "./sync-workflow";

export const runIntegrationSyncWorkflow = Effect.fn("IntegrationSyncWorkflow")(
	function* (payload: IntegrationSyncPayload, executionId: string) {
		yield* Effect.annotateCurrentSpan({ executionId, userId: payload.userId });
		const engine = yield* WorkflowEngine;
		const integrations = yield* IntegrationsService;

		const runs = yield* Activity.make({
			error: Schema.Never,
			name: "prepare-integration-sync-runs",
			success: Schema.Array(IntegrationSyncRun),
			execute: integrations.prepareYankRuns(payload.userId).pipe(Effect.orDie),
		});

		for (const run of runs) {
			yield* engine
				.execute(ProcessIntegrationRunWorkflow, {
					discard: true,
					executionId: run.runId,
					payload: { runId: run.runId, userId: run.userId, integrationId: run.integrationId },
				})
				.pipe(
					Effect.catchCause((cause) =>
						Effect.logError("integration sync run dispatch failed", cause).pipe(
							Effect.annotateLogs({ runId: run.runId }),
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

export const IntegrationSyncWorkflowDefinitionsLive = IntegrationSyncWorkflow.toLayer(
	runIntegrationSyncWorkflow,
);
