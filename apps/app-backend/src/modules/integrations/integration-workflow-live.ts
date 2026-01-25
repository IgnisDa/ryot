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
	const markStartedEffect = markImportRunStarted(payload.runId).pipe(
		Effect.mapError(toIntegrationWorkflowError),
	);
	yield* Activity.make({
		error: IntegrationRunError,
		name: "mark-integration-run-started",
		execute: markStartedEffect,
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

	const finalizationEffect = finalizeIntegrationRun(integration, payload.runId).pipe(
		Effect.mapError(toIntegrationWorkflowError),
	);
	const wasDisabled = yield* Activity.make({
		success: Schema.Boolean,
		error: IntegrationRunError,
		name: "finalize-integration-run",
		execute: finalizationEffect,
	});

	if (wasDisabled) {
		const signals = yield* SignalEmissionService;
		const emitDisabledSignal = signals
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
		yield* emitDisabledSignal;
	}
});

export const runIntegrationRunWorkflow = Effect.fn("ProcessIntegrationRunWorkflow")(
	function* (payload: IntegrationRunJobData, executionId: string) {
		yield* Effect.annotateCurrentSpan({
			executionId,
			runId: payload.runId,
			userId: payload.userId,
			integrationId: payload.integrationId,
		});
		const runWithDb = yield* DbRunner;
		const integrationsRepository = yield* IntegrationsRepository;

		const loadIntegrationEffect = runWithDb(
			integrationsRepository.getByIdAnyUser({ integrationId: payload.integrationId }),
		).pipe(Effect.mapError(toIntegrationWorkflowError));
		const integration = yield* Activity.make({
			name: "load-integration",
			error: IntegrationRunError,
			success: Schema.NullOr(IntegrationRecordSchema),
			execute: loadIntegrationEffect,
		});

		if (!integration) {
			yield* failRun("fail-run-integration-not-found", payload.runId, "Integration not found");
			return;
		}

		yield* runIntegrationRun(integration, payload, executionId);
	},
	(effect, _payload, executionId) =>
		Effect.annotateLogs(effect, { executionId, workflow: "ProcessIntegrationRunWorkflow" }),
);

const ProcessIntegrationRunWorkflowLive =
	ProcessIntegrationRunWorkflow.toLayer(runIntegrationRunWorkflow);

export const IntegrationWorkflowDefinitionsLive = ProcessIntegrationRunWorkflowLive.pipe(
	Layer.provide(IntegrationRunOperationsLive),
);
