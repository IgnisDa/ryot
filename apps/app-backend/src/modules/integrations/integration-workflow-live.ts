import { Activity } from "@effect/workflow";
import { ListedIntegration } from "@ryot/contract/modules/integrations/schemas";
import { UserId } from "@ryot/contract/schema/brands";
import { Cause, Effect, Layer, Schema } from "effect";

import { DbRunner } from "#lib/infrastructure/db/service";
import {
	markImportRunStarted,
	sanitizeErrorMessage,
} from "#modules/imports/runtime/import-run-status";
import { enqueueNotificationDelivery } from "#modules/notifications/notification-delivery-workflow";

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
		const deliveryExecutionId = `${executionId}-integration-disabled`;
		yield* enqueueNotificationDelivery({
			userId: integration.userId,
			executionId: deliveryExecutionId,
			request: {
				kind: "event",
				eventType: "integration_disabled_due_to_too_many_errors",
				message: `Integration ${integration.provider} has been disabled due to too many errors`,
			},
		}).pipe(Effect.mapError(toIntegrationWorkflowError));
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
	(payload, executionId) => runIntegrationRunWorkflow(payload, executionId),
);

export const IntegrationWorkflowDefinitionsLive = ProcessIntegrationRunWorkflowLive.pipe(
	Layer.provide(IntegrationRunOperationsLive),
);
