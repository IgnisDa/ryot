import { Activity, Workflow } from "@effect/workflow";
import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import { ListedIntegration } from "@ryot/contract/modules/integrations/schemas";
import { SignalId, SignalSchemaId, UserId } from "@ryot/contract/schema/brands";
import { Cause, DateTime, Effect, Layer, Schema } from "effect";

import { DbRunner } from "#lib/infrastructure/db/service";
import { AutomationsRepository } from "#modules/automations/repository";
import { emitAndDispatchSignal } from "#modules/automations/signal-dispatch";
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

	const wasDisabled = yield* Activity.make({
		success: Schema.Boolean,
		error: IntegrationRunError,
		name: "finalize-integration-run",
		execute: finalizeIntegrationRun(integration, payload.runId).pipe(
			Effect.mapError(toIntegrationWorkflowError),
		),
	});

	if (wasDisabled) {
		const engine = yield* WorkflowEngine;
		const runWithDb = yield* DbRunner;
		const automationsRepository = yield* AutomationsRepository;
		const signalId = SignalId.make(
			new Bun.CryptoHasher("sha256")
				.update(`${executionId}-integration-disabled`)
				.digest("base64url"),
		);
		const disabledSignal = yield* Activity.make({
			error: IntegrationRunError,
			name: "resolve-integration-disabled-signal",
			success: Schema.Struct({ signalSchemaId: SignalSchemaId, occurredAt: Schema.Date }),
			execute: Effect.gen(function* () {
				const signalSchemaId = yield* runWithDb(
					automationsRepository.getBuiltinSignalSchemaBySlug("integration.disabled"),
				).pipe(Effect.mapError(toIntegrationWorkflowError));
				if (!signalSchemaId) {
					return yield* new IntegrationRunError({
						message: "Missing built-in integration.disabled signal schema",
					});
				}
				const occurredAt = yield* DateTime.nowAsDate;
				return { signalSchemaId, occurredAt };
			}),
		});
		yield* emitAndDispatchSignal(engine, {
			id: signalId,
			trusted: true,
			automationDepth: 0,
			causationId: executionId,
			correlationId: executionId,
			occurredAt: disabledSignal.occurredAt,
			signalSchemaId: disabledSignal.signalSchemaId,
			principal: { kind: "user", userId: integration.userId },
			properties: { integrationId: integration.id, providerName: integration.provider },
			origin: {
				kind: "integration",
				importRunId: payload.runId,
				integrationId: integration.id,
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
