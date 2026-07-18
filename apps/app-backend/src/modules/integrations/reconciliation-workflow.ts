import { Effect, Layer, Schema } from "effect";
import { Activity, Workflow } from "effect/unstable/workflow";
import { WorkflowEngine } from "effect/unstable/workflow/WorkflowEngine";

import { withoutSchemaServices } from "#lib/shared/schema";

import { ProcessIntegrationRunWorkflow } from "./integration-workflow";
import { IntegrationReconciliationRun } from "./jobs";
import { IntegrationsService } from "./service";

export const IntegrationReconciliationPayload = Schema.Struct({
	executionId: Schema.String,
});

export type IntegrationReconciliationPayload = typeof IntegrationReconciliationPayload.Type;

export const IntegrationReconciliationWorkflow = Workflow.make(
	"IntegrationReconciliationWorkflow",
	{
		success: withoutSchemaServices(Schema.Void),
		error: withoutSchemaServices(Schema.Never),
		payload: withoutSchemaServices(IntegrationReconciliationPayload),
		idempotencyKey: ({ executionId }) => executionId,
	},
);

export const runIntegrationReconciliationWorkflow = Effect.fn("IntegrationReconciliationWorkflow")(
	function* (_payload: IntegrationReconciliationPayload, executionId: string) {
		yield* Effect.annotateCurrentSpan({ executionId });
		const engine = yield* WorkflowEngine;
		const integrations = yield* IntegrationsService;

		const runs = yield* Activity.make({
			error: Schema.Never,
			name: "prepare-scheduled-yank-runs",
			success: Schema.Array(IntegrationReconciliationRun),
			execute: integrations.prepareScheduledYankRuns().pipe(Effect.orDie),
		});

		for (const run of runs) {
			yield* engine
				.execute(ProcessIntegrationRunWorkflow, {
					discard: true,
					executionId: run.runId,
					payload: {
						runId: run.runId,
						userId: run.userId,
						integrationId: run.integrationId,
					},
				})
				.pipe(
					Effect.catchCause((cause) =>
						Effect.logError("integration reconciliation run dispatch failed", cause).pipe(
							Effect.annotateLogs({ runId: run.runId }),
						),
					),
				);
		}
	},
	(effect, _payload, executionId) =>
		Effect.annotateLogs(effect, { executionId, workflow: "IntegrationReconciliationWorkflow" }),
);

const IntegrationReconciliationWorkflowLive = IntegrationReconciliationWorkflow.toLayer(
	runIntegrationReconciliationWorkflow,
);

export const IntegrationReconciliationWorkflowDefinitionsLive = Layer.mergeAll(
	IntegrationReconciliationWorkflowLive,
);
