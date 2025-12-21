import { Activity, DurableQueue, Workflow } from "@effect/workflow";
import { Cause, DateTime, Effect, Layer, Schema } from "effect";

import { DbRunner } from "~/lib/db";
import type { SandboxRunError } from "~/lib/errors";
import { unknownToMessage } from "~/lib/errors";
import { MediaImportAdapterResultSchema } from "~/modules/imports/media/import-processor";
import {
	importMediaEntityViaWorkflow,
	resolveSandboxEntityExternalId,
} from "~/modules/imports/media/workflow-operations";
import { ImportsRepository } from "~/modules/imports/repository";
import { failImportRun, sanitizeErrorMessage } from "~/modules/imports/runtime/failures";
import { runOneTimeMediaImportWorkflow } from "~/modules/imports/workflows";

import { IntegrationRunError, IntegrationRunJobData } from "./jobs";
import { IntegrationsRepository, type IntegrationRecord } from "./repository";
import { ListedIntegration } from "./schemas";
import { getSinkAdapterResult } from "./sinks";
import {
	IntegrationRunQueue,
	IntegrationRunQueueWorkerLive,
	failAdapterOnlyRun,
	finalizeIntegrationRun,
} from "./worker";

const IntegrationRecordSchema = Schema.Struct({
	...ListedIntegration.fields,
	userId: Schema.String,
});

const toWorkflowError = (cause: unknown) =>
	new IntegrationRunError({ message: unknownToMessage(cause) });

type SinkMediaOperations<RResolve, RImport> = {
	resolveExternalId: (input: {
		value: string;
		userId: string;
		scriptId: string;
		executionId: string;
		identifierType: string;
	}) => Effect.Effect<{ externalId: string | null }, SandboxRunError, RResolve>;
	importEntity: (input: {
		userId: string;
		scriptId: string;
		externalId: string;
		executionId: string;
		entitySchemaId: string;
		activityPrefix: string;
	}) => Effect.Effect<{ id: string }, SandboxRunError, RImport>;
};

type IntegrationRunOperations<RYank, RResolve, RImport> = SinkMediaOperations<RResolve, RImport> & {
	processYank: (payload: IntegrationRunJobData) => Effect.Effect<void, IntegrationRunError, RYank>;
};

const failRun = (name: string, runId: string, message: string) =>
	Activity.make({
		name,
		error: IntegrationRunError,
		execute: failImportRun(runId, message).pipe(Effect.mapError(toWorkflowError)),
	});

const processSinkMedia = <RResolve, RImport>(
	integration: IntegrationRecord,
	payload: IntegrationRunJobData,
	executionId: string,
	operations: SinkMediaOperations<RResolve, RImport>,
) =>
	Effect.gen(function* () {
		const adapterResult = yield* Activity.make({
			error: IntegrationRunError,
			name: "parse-sink-adapter",
			success: MediaImportAdapterResultSchema,
			execute: Effect.sync(() =>
				getSinkAdapterResult(
					integration,
					payload.rawBody ?? "",
					payload.contentType ?? "application/json",
				),
			),
		});

		if (adapterResult.entityGroups.length === 0 && adapterResult.failures.length > 0) {
			yield* Activity.make({
				error: IntegrationRunError,
				name: "record-adapter-only-sink-failure",
				execute: failAdapterOnlyRun(payload.runId, adapterResult).pipe(
					Effect.mapError(toWorkflowError),
				),
			});
			return;
		}

		yield* runOneTimeMediaImportWorkflow(
			{ runId: payload.runId, userId: integration.userId, source: integration.provider },
			executionId,
			{
				cleanupArtifacts: () => Effect.void,
				importEntity: operations.importEntity,
				resolveExternalId: operations.resolveExternalId,
				loadAdapterResult: () => Effect.succeed({ adapterResult, cleanupPaths: [] }),
			},
			{ skipMarkStarted: true },
		).pipe(Effect.mapError((error) => new IntegrationRunError({ message: error.message })));
	});

const runSinkIntegrationRun = <RResolve, RImport>(
	integration: IntegrationRecord,
	payload: IntegrationRunJobData,
	executionId: string,
	operations: SinkMediaOperations<RResolve, RImport>,
) =>
	Effect.gen(function* () {
		const runWithDb = yield* DbRunner;
		const repository = yield* ImportsRepository;
		const integrationsRepository = yield* IntegrationsRepository;

		if (integration.isDisabled) {
			yield* failRun("fail-run-integration-disabled", payload.runId, "Integration is disabled");
			return;
		}

		const integrationsDisabled = yield* Activity.make({
			success: Schema.Boolean,
			error: IntegrationRunError,
			name: "load-user-disable-integrations",
			execute: runWithDb(
				integrationsRepository.getUserDisableIntegrations({ userId: integration.userId }),
			).pipe(Effect.mapError(toWorkflowError)),
		});
		if (integrationsDisabled) {
			yield* failRun(
				"fail-run-integrations-disabled",
				payload.runId,
				"Integrations are disabled for this user",
			);
			return;
		}

		const startedAt = yield* DateTime.nowAsDate;
		yield* Activity.make({
			error: IntegrationRunError,
			name: "mark-integration-run-started",
			execute: runWithDb(
				repository.updateRun({ runId: payload.runId, status: "running", startedAt }),
			).pipe(Effect.mapError(toWorkflowError)),
		});

		yield* processSinkMedia(integration, payload, executionId, operations).pipe(
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
				Effect.mapError(toWorkflowError),
			),
		});
	});

export const runIntegrationRunWorkflow = <RYank, RResolve, RImport>(
	payload: IntegrationRunJobData,
	executionId: string,
	operations: IntegrationRunOperations<RYank, RResolve, RImport>,
) =>
	Effect.gen(function* () {
		const runWithDb = yield* DbRunner;
		const integrationsRepository = yield* IntegrationsRepository;

		const integration = yield* Activity.make({
			name: "load-integration",
			error: IntegrationRunError,
			success: Schema.NullOr(IntegrationRecordSchema),
			execute: runWithDb(
				integrationsRepository.getByIdAnyUser({ integrationId: payload.integrationId }),
			).pipe(Effect.mapError(toWorkflowError)),
		});

		if (!integration) {
			yield* failRun("fail-run-integration-not-found", payload.runId, "Integration not found");
			return;
		}

		if (integration.lot !== "sink") {
			// TODO: Temporary bridge: yank runs stay on the durable queue worker until the yank
			// workflow task moves their orchestration into this workflow body.
			yield* operations.processYank(payload);
			return;
		}

		yield* runSinkIntegrationRun(integration, payload, executionId, operations);
	});

export const ProcessIntegrationRunWorkflow = Workflow.make({
	success: Schema.Void,
	error: IntegrationRunError,
	payload: IntegrationRunJobData,
	idempotencyKey: ({ runId }) => runId,
	name: "ProcessIntegrationRunWorkflow",
});

const ProcessIntegrationRunWorkflowLive = ProcessIntegrationRunWorkflow.toLayer(
	(payload, executionId) =>
		runIntegrationRunWorkflow(payload, executionId, {
			importEntity: importMediaEntityViaWorkflow,
			resolveExternalId: resolveSandboxEntityExternalId,
			processYank: (yankPayload) => DurableQueue.process(IntegrationRunQueue, yankPayload),
		}),
);

export const IntegrationWorkflowDefinitionsLive = Layer.mergeAll(
	IntegrationRunQueueWorkerLive,
	ProcessIntegrationRunWorkflowLive,
);
