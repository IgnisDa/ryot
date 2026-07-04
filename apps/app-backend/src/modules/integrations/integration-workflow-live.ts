import { Activity } from "@effect/workflow";
import { ListedIntegration } from "@ryot/contract/modules/integrations/schemas";
import { UserId } from "@ryot/contract/schema/brands";
import { Cause, DateTime, Effect, Layer, Schema } from "effect";

import { DbRunner } from "#lib/infrastructure/db/service";
import {
	markImportRunStarted,
	sanitizeErrorMessage,
} from "#modules/imports/runtime/import-run-status";
import { SignalEmissionService } from "#modules/signals/service";

import { failRun, toIntegrationWorkflowError } from "./failure-workflow";
import { ProcessIntegrationRunWorkflow } from "./integration-workflow";
import { IntegrationRunError, type IntegrationRunJobData } from "./jobs";
import { processIntegrationMedia } from "./media-workflow";
import { IntegrationRunOperationsLive } from "./operations-workflow";
import { IntegrationsRepository, type IntegrationRecord } from "./repository";
import { finalizeIntegrationRun } from "./worker";

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

	const wasDisabled = yield* Activity.make({
		success: Schema.Boolean,
		error: IntegrationRunError,
		name: "finalize-integration-run",
		execute: finalizeIntegrationRun(integration, payload.runId).pipe(
			Effect.mapError(toIntegrationWorkflowError),
		),
	});

	if (wasDisabled) {
		const signals = yield* SignalEmissionService;
		yield* signals
			.emit({
				executionId,
				discriminator: integration.id,
				schemaSlug: "integration.disabled",
				occurredAt: yield* DateTime.nowAsDate,
				principal: { kind: "user", userId: integration.userId },
				properties: { integrationId: integration.id, providerName: integration.provider },
				origin: { kind: "integration", importRunId: payload.runId, integrationId: integration.id },
			})
			.pipe(Effect.mapError(toIntegrationWorkflowError));
	}
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

const ProcessIntegrationRunWorkflowLive = ProcessIntegrationRunWorkflow.toLayer(
	(payload, executionId) =>
		runIntegrationRunWorkflow(payload, executionId).pipe(
			Effect.withSpan("ProcessIntegrationRunWorkflow", {
				attributes: {
					executionId,
					runId: payload.runId,
					userId: payload.userId,
					integrationId: payload.integrationId,
				},
			}),
			Effect.annotateLogs({ executionId, workflow: "ProcessIntegrationRunWorkflow" }),
		),
);

export const IntegrationWorkflowDefinitionsLive = ProcessIntegrationRunWorkflowLive.pipe(
	Layer.provide(IntegrationRunOperationsLive),
);
