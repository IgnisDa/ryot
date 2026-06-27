import { Activity, Workflow } from "@effect/workflow";
import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import { Effect, Layer, Schema } from "effect";

import { ProcessIntegrationRunWorkflow } from "./integration-workflow";
import { IntegrationReconciliationRun } from "./jobs";
import { IntegrationsService } from "./service";

export const IntegrationReconciliationPayload = Schema.Struct({
	executionId: Schema.String,
});

export type IntegrationReconciliationPayload = typeof IntegrationReconciliationPayload.Type;

export const IntegrationReconciliationWorkflow = Workflow.make({
	success: Schema.Void,
	error: Schema.Never,
	name: "IntegrationReconciliationWorkflow",
	payload: IntegrationReconciliationPayload,
	idempotencyKey: ({ executionId }) => executionId,
});

export const runIntegrationReconciliationWorkflow = Effect.fn(
	"runIntegrationReconciliationWorkflow",
)(function* (_payload: IntegrationReconciliationPayload) {
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
				Effect.catchAllCause((cause) =>
					Effect.logError("integration reconciliation run dispatch failed", run.runId, cause),
				),
			);
	}
});

const IntegrationReconciliationWorkflowLive = IntegrationReconciliationWorkflow.toLayer((payload) =>
	runIntegrationReconciliationWorkflow(payload),
);

export const IntegrationReconciliationWorkflowDefinitionsLive = Layer.mergeAll(
	IntegrationReconciliationWorkflowLive,
);
