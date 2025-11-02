import * as PersistedQueue from "@effect/experimental/PersistedQueue";
import { HttpClient } from "@effect/platform";
import { Activity, Workflow } from "@effect/workflow";
import type { WorkflowEngine, WorkflowInstance } from "@effect/workflow/WorkflowEngine";
import { Cause, Context, Effect, Either, Layer, Schema } from "effect";

import { DbRunner } from "#lib/db";
import type { SandboxRunError } from "#lib/errors";
import { unknownToMessage } from "#lib/errors";
import type { ImportRunId } from "#lib/schema/brands";
import { SandboxScriptId, UserId } from "#lib/schema/brands";
import { EntitiesRepository } from "#modules/entities/repository";
import {
	MediaImportAdapterResultSchema,
	type MediaImportAdapterFailure,
	type MediaImportAdapterResult,
} from "#modules/imports/media/adapter-result";
import { MediaImportWorkflowOperationsLive } from "#modules/imports/media/workflow-operations";
import {
	failImportRun,
	failImportRunWithFailures,
	markImportRunStarted,
	sanitizeErrorMessage,
	type ImportRunFailureDetails,
} from "#modules/imports/runtime/import-run-status";
import { ImportRunArtifacts } from "#modules/imports/runtime/workflow-helpers";
import { runLoadedMediaImportWorkflow } from "#modules/imports/workflows";
import type { SandboxCompletedResult } from "#modules/sandbox/schemas";

import { IntegrationRunError, IntegrationRunJobData } from "./jobs";
import { IntegrationsRepository, type IntegrationRecord } from "./repository";
import { ListedIntegration } from "./schemas";
import { getSinkAdapterResult } from "./sinks";
import {
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
	userId: UserId,
});

const toWorkflowError = (cause: unknown) =>
	new IntegrationRunError({ message: unknownToMessage(cause) });

export type IntegrationRunOperationsValue = {
	loadYankAdapterResult: (integration: IntegrationRecord) => Effect.Effect<
		{
			cleanupPaths: ReadonlyArray<string>;
			adapterResult: typeof MediaImportAdapterResultSchema.Type;
		},
		{ cleanupPaths: ReadonlyArray<string>; message: string }
	>;
	runSandboxHistory: (input: {
		userId: UserId;
		executionId: string;
		scriptId: SandboxScriptId;
		context: { authCookie: string; timezone: string };
	}) => Effect.Effect<SandboxCompletedResult, SandboxRunError, WorkflowEngine | WorkflowInstance>;
};

export class IntegrationRunOperations extends Context.Tag("IntegrationRunOperations")<
	IntegrationRunOperations,
	IntegrationRunOperationsValue
>() {}

const IntegrationRunOperationsLive = Layer.effect(
	IntegrationRunOperations,
	Effect.gen(function* () {
		const httpClient = yield* HttpClient.HttpClient;
		const queueFactory = yield* PersistedQueue.PersistedQueueFactory;

		return {
			loadYankAdapterResult: (integration) =>
				loadYankAdapterResult(integration).pipe(
					Effect.provideService(HttpClient.HttpClient, httpClient),
				),
			runSandboxHistory: (input) =>
				runYoutubeMusicHistorySandbox(input).pipe(
					Effect.provideService(PersistedQueue.PersistedQueueFactory, queueFactory),
				),
		};
	}),
);

const failRun = (name: string, runId: ImportRunId, message: string) =>
	Activity.make({
		name,
		error: IntegrationRunError,
		execute: failImportRun(runId, message).pipe(Effect.mapError(toWorkflowError)),
	});

const toImportFailure = (failure: MediaImportAdapterFailure): ImportRunFailureDetails => ({
	message: failure.message,
	itemIndex: failure.itemIndex,
	sourceLabel: failure.sourceLabel,
	sourceIdentifier: failure.sourceIdentifier,
	stage: failure.stage ?? "input_transformation",
	context: failure.context ? { ...failure.context } : null,
});

const failRunWithFailures = (input: {
	name: string;
	runId: ImportRunId;
	errorSummary?: string;
	failures: ReadonlyArray<ImportRunFailureDetails>;
}) =>
	Activity.make({
		name: input.name,
		error: IntegrationRunError,
		execute: failImportRunWithFailures({
			runId: input.runId,
			failures: input.failures,
			...(input.errorSummary !== undefined ? { errorSummary: input.errorSummary } : {}),
		}).pipe(Effect.mapError(toWorkflowError)),
	});

const failRunWithAdapterFailures = (
	name: string,
	runId: ImportRunId,
	result: MediaImportAdapterResult,
) => failRunWithFailures({ name, runId, failures: result.failures.map(toImportFailure) });

const IntegrationMediaLoadOutcome = Schema.Union(
	Schema.TaggedStruct("failed", {
		message: Schema.String,
		cleanupPaths: Schema.Array(Schema.String),
	}),
	Schema.TaggedStruct("loaded", {
		cleanupPaths: Schema.Array(Schema.String),
		adapterResult: MediaImportAdapterResultSchema,
	}),
);

const runMediaImportForIntegration = (
	integration: IntegrationRecord,
	payload: IntegrationRunJobData,
	executionId: string,
	loaded: {
		cleanupPaths: ReadonlyArray<string>;
		adapterResult: typeof MediaImportAdapterResultSchema.Type;
	},
) =>
	runLoadedMediaImportWorkflow({
		executionId,
		cleanupOnSuccess: false,
		cleanupPaths: loaded.cleanupPaths,
		adapterResult: loaded.adapterResult,
		options: { integrationId: integration.id },
		payload: { runId: payload.runId, userId: integration.userId, source: integration.provider },
	}).pipe(
		Effect.mapError((error) => new IntegrationRunError({ message: unknownToMessage(error) })),
	);

const processSinkMedia = Effect.fn("processSinkMedia")(function* (
	integration: IntegrationRecord,
	payload: IntegrationRunJobData,
	executionId: string,
) {
	const adapterResult = yield* Activity.make({
		error: IntegrationRunError,
		name: "parse-sink-adapter",
		success: MediaImportAdapterResultSchema,
		execute: getSinkAdapterResult(
			integration,
			payload.rawBody ?? "",
			payload.contentType ?? "application/json",
		),
	});

	if (adapterResult.entityGroups.length === 0 && adapterResult.failures.length > 0) {
		yield* failRunWithAdapterFailures(
			"record-adapter-only-sink-failure",
			payload.runId,
			adapterResult,
		);
		return;
	}

	yield* runMediaImportForIntegration(integration, payload, executionId, {
		adapterResult,
		cleanupPaths: [],
	});
});

const processYoutubeMusicYank = Effect.fn("processYoutubeMusicYank")(function* (
	integration: IntegrationRecord,
	payload: IntegrationRunJobData,
	executionId: string,
	credentials: { authCookie: string; timezone: string },
) {
	const runWithDb = yield* DbRunner;
	const operations = yield* IntegrationRunOperations;
	const entitiesRepository = yield* EntitiesRepository;

	const adapterResult = yield* Effect.gen(function* () {
		const scriptId = yield* Activity.make({
			error: IntegrationRunError,
			name: "load-youtube-music-history-script",
			success: Schema.NullOr(SandboxScriptId),
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
		yield* failRunWithAdapterFailures(
			"record-youtube-music-source-fetch-failure",
			payload.runId,
			adapterResult,
		);
		return;
	}

	yield* runMediaImportForIntegration(integration, payload, executionId, {
		adapterResult,
		cleanupPaths: [],
	});
});

const processYankMedia = Effect.fn("processYankMedia")(function* (
	integration: IntegrationRecord,
	payload: IntegrationRunJobData,
	executionId: string,
) {
	const operations = yield* IntegrationRunOperations;
	const specs = integration.providerSpecifics;
	if (specs.kind === "youtube_music") {
		yield* processYoutubeMusicYank(integration, payload, executionId, {
			timezone: specs.timezone,
			authCookie: specs.authCookie,
		});
		return;
	}

	if (specs.kind === "audiobookshelf" || specs.kind === "plex_yank" || specs.kind === "komga") {
		const loadOutcome = yield* Activity.make({
			name: "load-media-import-adapter-result",
			success: IntegrationMediaLoadOutcome,
			execute: operations.loadYankAdapterResult(integration).pipe(
				Effect.map((loaded) => ({
					_tag: "loaded" as const,
					adapterResult: loaded.adapterResult,
					cleanupPaths: [...loaded.cleanupPaths],
				})),
				Effect.catchAll((error) =>
					Effect.succeed({
						message: error.message,
						_tag: "failed" as const,
						cleanupPaths: [...error.cleanupPaths],
					}),
				),
				Effect.catchAllCause((cause) =>
					Effect.succeed({
						cleanupPaths: [],
						_tag: "failed" as const,
						message: unknownToMessage(Cause.squash(cause)),
					}),
				),
			),
		});
		if (loadOutcome._tag === "failed") {
			yield* failRun("fail-import-run-on-load-error", payload.runId, loadOutcome.message);
			return;
		}

		yield* runMediaImportForIntegration(integration, payload, executionId, loadOutcome);
		return;
	}

	const message = `${integration.provider} integration is not implemented in V2 yet`;
	yield* failRunWithFailures({
		runId: payload.runId,
		errorSummary: message,
		name: "record-unsupported-yank-run",
		failures: [{ message, itemIndex: 0, stage: "source_fetch" }],
	});
});

const processIntegrationMedia = (
	integration: IntegrationRecord,
	payload: IntegrationRunJobData,
	executionId: string,
) =>
	integration.lot === "sink"
		? processSinkMedia(integration, payload, executionId)
		: processYankMedia(integration, payload, executionId);

const runIntegrationRun = Effect.fn("runIntegrationRun")(function* (
	integration: IntegrationRecord,
	payload: IntegrationRunJobData,
	executionId: string,
) {
	yield* Activity.make({
		error: IntegrationRunError,
		name: "mark-integration-run-started",
		execute: markImportRunStarted(payload.runId).pipe(Effect.mapError(toWorkflowError)),
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
			Effect.mapError(toWorkflowError),
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
		).pipe(Effect.mapError(toWorkflowError)),
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
	Layer.provide(
		Layer.mergeAll(
			ImportRunArtifacts.Default,
			IntegrationRunOperationsLive,
			MediaImportWorkflowOperationsLive,
		),
	),
);
