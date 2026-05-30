import { Activity, Workflow } from "@effect/workflow";
import { Cause, DateTime, Effect, Either, Schema } from "effect";

import { DbRunner } from "#lib/db";
import type { SandboxRunError } from "#lib/errors";
import { unknownToMessage } from "#lib/errors";
import { EntitiesRepository } from "#modules/entities/repository";
import { MediaImportAdapterResultSchema } from "#modules/imports/media/import-processor";
import {
	importMediaEntityViaWorkflow,
	resolveSandboxEntityExternalId,
} from "#modules/imports/media/workflow-operations";
import { ImportsRepository } from "#modules/imports/repository";
import { failImportRun, sanitizeErrorMessage } from "#modules/imports/runtime/failures";
import { runOneTimeMediaImportWorkflow } from "#modules/imports/workflows";
import type { SandboxCompletedResult } from "#modules/sandbox/schemas";

import { IntegrationRunError, IntegrationRunJobData } from "./jobs";
import { IntegrationsRepository, type IntegrationRecord } from "./repository";
import { ListedIntegration } from "./schemas";
import { getSinkAdapterResult } from "./sinks";
import {
	failAdapterOnlyRun,
	failUnsupportedIntegrationRun,
	finalizeIntegrationRun,
	loadYankAdapterResult,
	runYoutubeMusicHistorySandbox,
} from "./worker";
import {
	YOUTUBE_MUSIC_SCRIPT_SLUG,
	buildYoutubeMusicAdapterResult,
	sourceFetchFailure,
} from "./yank/youtube-music";

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

type YankMediaOperations<RYank, RHistory> = {
	loadYankAdapterResult: (integration: IntegrationRecord) => Effect.Effect<
		{
			cleanupPaths: ReadonlyArray<string>;
			adapterResult: typeof MediaImportAdapterResultSchema.Type;
		},
		{ cleanupPaths: ReadonlyArray<string>; message: string },
		RYank
	>;
	runSandboxHistory: (input: {
		userId: string;
		scriptId: string;
		executionId: string;
		context: { authCookie: string; timezone: string };
	}) => Effect.Effect<SandboxCompletedResult, SandboxRunError, RHistory>;
};

type IntegrationRunOperations<RResolve, RImport, RYank, RHistory> = SinkMediaOperations<
	RResolve,
	RImport
> &
	YankMediaOperations<RYank, RHistory>;

const failRun = (name: string, runId: string, message: string) =>
	Activity.make({
		name,
		error: IntegrationRunError,
		execute: failImportRun(runId, message).pipe(Effect.mapError(toWorkflowError)),
	});

const runMediaImportForIntegration = <RResolve, RImport, RLoad>(
	integration: IntegrationRecord,
	payload: IntegrationRunJobData,
	executionId: string,
	operations: SinkMediaOperations<RResolve, RImport>,
	loadAdapterResult: () => Effect.Effect<
		{
			cleanupPaths: ReadonlyArray<string>;
			adapterResult: typeof MediaImportAdapterResultSchema.Type;
		},
		{ cleanupPaths: ReadonlyArray<string>; message: string },
		RLoad
	>,
) =>
	runOneTimeMediaImportWorkflow(
		{ runId: payload.runId, userId: integration.userId, source: integration.provider },
		executionId,
		{
			loadAdapterResult,
			cleanupArtifacts: () => Effect.void,
			importEntity: operations.importEntity,
			resolveExternalId: operations.resolveExternalId,
		},
		{ integrationId: integration.id, skipMarkStarted: true },
	).pipe(Effect.mapError((error) => new IntegrationRunError({ message: error.message })));

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

		yield* runMediaImportForIntegration(integration, payload, executionId, operations, () =>
			Effect.succeed({ adapterResult, cleanupPaths: [] }),
		);
	});

const processYoutubeMusicYank = <RResolve, RImport, RHistory>(
	integration: IntegrationRecord,
	payload: IntegrationRunJobData,
	executionId: string,
	operations: SinkMediaOperations<RResolve, RImport> &
		Pick<YankMediaOperations<never, RHistory>, "runSandboxHistory">,
	credentials: { authCookie: string; timezone: string },
) =>
	Effect.gen(function* () {
		const runWithDb = yield* DbRunner;
		const entitiesRepository = yield* EntitiesRepository;

		const adapterResult = yield* Effect.gen(function* () {
			const scriptId = yield* Activity.make({
				error: IntegrationRunError,
				name: "load-youtube-music-history-script",
				success: Schema.NullOr(Schema.String),
				execute: runWithDb(
					entitiesRepository.findEntitySchemaScriptBySlug(YOUTUBE_MUSIC_SCRIPT_SLUG),
				).pipe(
					Effect.map((script) => script?.sandboxScriptId ?? null),
					Effect.mapError(toWorkflowError),
				),
			});
			if (!scriptId) {
				return sourceFetchFailure("YouTube Music sandbox script is not available");
			}

			const sandbox = yield* operations
				.runSandboxHistory({
					scriptId,
					context: credentials,
					userId: integration.userId,
					executionId: `${executionId}-youtube-music-history`,
				})
				.pipe(Effect.either);
			if (Either.isLeft(sandbox)) {
				return sourceFetchFailure(sandbox.left.message);
			}
			if (sandbox.right.error) {
				return sourceFetchFailure(sandbox.right.error);
			}

			return yield* Activity.make({
				error: IntegrationRunError,
				success: MediaImportAdapterResultSchema,
				name: "build-youtube-music-adapter-result",
				execute: buildYoutubeMusicAdapterResult(
					{
						userId: integration.userId,
						integrationId: integration.id,
						timezone: credentials.timezone,
					},
					sandbox.right.value,
				).pipe(Effect.mapError(toWorkflowError)),
			});
		});

		if (adapterResult.entityGroups.length === 0 && adapterResult.failures.length > 0) {
			yield* Activity.make({
				error: IntegrationRunError,
				name: "record-youtube-music-source-fetch-failure",
				execute: failAdapterOnlyRun(payload.runId, adapterResult).pipe(
					Effect.mapError(toWorkflowError),
				),
			});
			return;
		}

		yield* runMediaImportForIntegration(integration, payload, executionId, operations, () =>
			Effect.succeed({ adapterResult, cleanupPaths: [] }),
		);
	});

const processYankMedia = <RResolve, RImport, RYank, RHistory>(
	integration: IntegrationRecord,
	payload: IntegrationRunJobData,
	executionId: string,
	operations: IntegrationRunOperations<RResolve, RImport, RYank, RHistory>,
) =>
	Effect.gen(function* () {
		const specs = integration.providerSpecifics;
		if (specs.kind === "youtube_music") {
			yield* processYoutubeMusicYank(integration, payload, executionId, operations, {
				timezone: specs.timezone,
				authCookie: specs.authCookie,
			});
			return;
		}

		if (specs.kind === "audiobookshelf" || specs.kind === "plex_yank" || specs.kind === "komga") {
			yield* runMediaImportForIntegration(integration, payload, executionId, operations, () =>
				operations.loadYankAdapterResult(integration),
			);
			return;
		}

		yield* Activity.make({
			error: IntegrationRunError,
			name: "record-unsupported-yank-run",
			execute: failUnsupportedIntegrationRun(payload.runId, integration.provider).pipe(
				Effect.mapError(toWorkflowError),
			),
		});
	});

const processIntegrationMedia = <RResolve, RImport, RYank, RHistory>(
	integration: IntegrationRecord,
	payload: IntegrationRunJobData,
	executionId: string,
	operations: IntegrationRunOperations<RResolve, RImport, RYank, RHistory>,
) =>
	integration.lot === "sink"
		? processSinkMedia(integration, payload, executionId, operations)
		: processYankMedia(integration, payload, executionId, operations);

const runIntegrationRun = <RResolve, RImport, RYank, RHistory>(
	integration: IntegrationRecord,
	payload: IntegrationRunJobData,
	executionId: string,
	operations: IntegrationRunOperations<RResolve, RImport, RYank, RHistory>,
) =>
	Effect.gen(function* () {
		const runWithDb = yield* DbRunner;
		const repository = yield* ImportsRepository;

		const startedAt = yield* DateTime.nowAsDate;
		yield* Activity.make({
			error: IntegrationRunError,
			name: "mark-integration-run-started",
			execute: runWithDb(
				repository.updateRun({ runId: payload.runId, status: "running", startedAt }),
			).pipe(Effect.mapError(toWorkflowError)),
		});

		yield* processIntegrationMedia(integration, payload, executionId, operations).pipe(
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

export const runIntegrationRunWorkflow = <RResolve, RImport, RYank, RHistory>(
	payload: IntegrationRunJobData,
	executionId: string,
	operations: IntegrationRunOperations<RResolve, RImport, RYank, RHistory>,
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

		yield* runIntegrationRun(integration, payload, executionId, operations);
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
			loadYankAdapterResult,
			importEntity: importMediaEntityViaWorkflow,
			runSandboxHistory: runYoutubeMusicHistorySandbox,
			resolveExternalId: resolveSandboxEntityExternalId,
		}),
);

export const IntegrationWorkflowDefinitionsLive = ProcessIntegrationRunWorkflowLive;
