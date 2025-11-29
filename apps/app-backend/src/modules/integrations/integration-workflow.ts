import { Activity, Workflow } from "@effect/workflow";
import { ListedIntegration } from "@ryot/contract/modules/integrations/schemas";
import { UserId } from "@ryot/contract/schema/brands";
import { Cause, Effect, Layer, Schema } from "effect";

import { DbRunner } from "#lib/infrastructure/db/service";
import {
	markImportRunStarted,
	sanitizeErrorMessage,
} from "#modules/imports/runtime/import-run-status";

import { failRun, toIntegrationWorkflowError } from "./failure-workflow";
import { IntegrationRunError, IntegrationRunJobData } from "./jobs";
import { processIntegrationMedia } from "./media-workflow";
import { IntegrationRunOperationsLive } from "./operations-workflow";
import { IntegrationsRepository, type IntegrationRecord } from "./repository";
import { finalizeIntegrationRun } from "./worker";

export {
	IntegrationRunOperations,
	type IntegrationRunOperationsValue,
} from "./operations-workflow";

const IntegrationRecordSchema = Schema.Struct({
	...ListedIntegration.fields,
	userId: UserId,
});

const runIntegrationRun = Effect.fn("runIntegrationRun")(function* (
	integration: IntegrationRecord,
	payload: IntegrationRunJobData,
	executionId: string,
) {
	yield* Activity.make({
		error: IntegrationRunError,
		name: "mark-integration-run-started",
		execute: markImportRunStarted(payload.runId).pipe(Effect.mapError(toIntegrationWorkflowError)),
	});

	yield* processIntegrationMedia(integration, payload, executionId).pipe(
		Effect.catchAllCause((cause) =>
			failRun(
				"fail-integration-run-unexpected",
				payload.runId,
				sanitizeErrorMessage(Cause.squash(cause), "Integration job failed unexpectedly"),
			),
		),
	);

	yield* Activity.make({
		error: IntegrationRunError,
		name: "finalize-integration-run",
		execute: finalizeIntegrationRun(integration, payload.runId).pipe(
			Effect.mapError(toIntegrationWorkflowError),
		),
	});
});

export const runIntegrationRunWorkflow = Effect.fn("runIntegrationRunWorkflow")(function* (
	payload: IntegrationRunJobData,
	executionId: string,
) {
	const runWithDb = yield* DbRunner;
	const integrationsRepository = yield* IntegrationsRepository;

	const integration = yield* Activity.make({
		name: "load-integration",
		error: IntegrationRunError,
		success: Schema.NullOr(IntegrationRecordSchema),
		execute: runWithDb(
			integrationsRepository.getByIdAnyUser({ integrationId: payload.integrationId }),
		).pipe(Effect.mapError(toIntegrationWorkflowError)),
	});

	if (!integration) {
		yield* failRun("fail-run-integration-not-found", payload.runId, "Integration not found");
		return;
	}

	yield* runIntegrationRun(integration, payload, executionId);
});

export const ProcessIntegrationRunWorkflow = Workflow.make({
	success: Schema.Void,
	error: IntegrationRunError,
	payload: IntegrationRunJobData,
	idempotencyKey: ({ runId }) => runId,
	name: "ProcessIntegrationRunWorkflow",
});

const ProcessIntegrationRunWorkflowLive = ProcessIntegrationRunWorkflow.toLayer(
	(payload, executionId) => runIntegrationRunWorkflow(payload, executionId),
);

export const IntegrationWorkflowDefinitionsLive = ProcessIntegrationRunWorkflowLive.pipe(
	Layer.provide(IntegrationRunOperationsLive),
);
