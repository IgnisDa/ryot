import { Activity } from "@effect/workflow";
import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import { unknownToMessage } from "@ryot/contract/errors";
import { SandboxScriptId } from "@ryot/contract/schema/brands";
import { Cause, Effect, Either, Schema } from "effect";

import { DbRunner } from "#lib/infrastructure/db/service";
import { EntitiesRepository } from "#modules/entities/repository";
import {
	MediaImportAdapterSummarySchema,
	toMediaImportAdapterSummary,
} from "#modules/imports/media/adapter-result";
import { ProcessNormalizedMediaImportWorkflow } from "#modules/imports/media/normalized-import-workflow";
import { storeImportAdapterResult } from "#modules/imports/runtime/source-payload-store";

import {
	failRun,
	failRunWithAdapterFailures,
	failRunWithFailures,
	toIntegrationWorkflowError,
} from "./failure-workflow";
import type { IntegrationRunJobData } from "./jobs";
import { IntegrationRunError } from "./jobs";
import { IntegrationRunOperations } from "./operations-workflow";
import type { IntegrationRecord } from "./repository";
import { getSinkAdapterResult } from "./sinks/sink-adapters";
import {
	YOUTUBE_MUSIC_SCRIPT_SLUG,
	buildYoutubeMusicAdapterResult,
	sourceFetchFailure,
} from "./yank/youtube-music";

const IntegrationMediaLoadOutcome = Schema.Union(
	Schema.TaggedStruct("failed", {
		message: Schema.String,
		cleanupPaths: Schema.Array(Schema.String),
	}),
	Schema.TaggedStruct("loaded", {
		cleanupPaths: Schema.Array(Schema.String),
		summary: MediaImportAdapterSummarySchema,
	}),
);

const runMediaImportForIntegration = (
	integration: IntegrationRecord,
	payload: IntegrationRunJobData,
	executionId: string,
) =>
	Effect.gen(function* () {
		const engine = yield* WorkflowEngine;
		const childExecutionId = `${executionId}-normalized`;
		yield* engine
			.execute(ProcessNormalizedMediaImportWorkflow, {
				executionId: childExecutionId,
				payload: {
					executionId: childExecutionId,
					runId: payload.runId,
					userId: integration.userId,
					integrationId: integration.id,
				},
			})
			.pipe(
				Effect.mapError((error) => new IntegrationRunError({ message: unknownToMessage(error) })),
			);
	});

const processSinkMedia = Effect.fn("processSinkMedia")(function* (
	integration: IntegrationRecord,
	payload: IntegrationRunJobData,
	executionId: string,
) {
	const summary = yield* Activity.make({
		error: IntegrationRunError,
		name: "parse-sink-adapter",
		success: MediaImportAdapterSummarySchema,
		execute: getSinkAdapterResult(
			integration,
			payload.rawBody ?? "",
			payload.contentType ?? "application/json",
		).pipe(
			Effect.flatMap((adapterResult) =>
				storeImportAdapterResult({ runId: payload.runId, adapterResult }).pipe(
					Effect.as(toMediaImportAdapterSummary(adapterResult)),
				),
			),
		),
	});

	if (summary.groups === 0 && summary.failures.length > 0) {
		yield* failRunWithAdapterFailures(
			"record-adapter-only-sink-failure",
			payload.runId,
			summary.failures,
		);
		return;
	}

	yield* runMediaImportForIntegration(integration, payload, executionId);
});

const buildYoutubeMusicImportResult = Effect.fn("buildYoutubeMusicImportResult")(function* (
	integration: IntegrationRecord,
	runId: IntegrationRunJobData["runId"],
	executionId: string,
	credentials: { authCookie: string; timezone: string },
) {
	const runWithDb = yield* DbRunner;
	const operations = yield* IntegrationRunOperations;
	const entitiesRepository = yield* EntitiesRepository;

	const scriptId = yield* Activity.make({
		error: IntegrationRunError,
		name: "load-youtube-music-history-script",
		success: Schema.NullOr(SandboxScriptId),
		execute: runWithDb(
			entitiesRepository.findEntitySchemaSandboxScriptBySlug(YOUTUBE_MUSIC_SCRIPT_SLUG),
		).pipe(
			Effect.map((script) => script?.sandboxScriptId ?? null),
			Effect.mapError(toIntegrationWorkflowError),
		),
	});
	if (!scriptId) {
		return toMediaImportAdapterSummary(
			sourceFetchFailure("YouTube Music sandbox script is not available"),
		);
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
		return toMediaImportAdapterSummary(sourceFetchFailure(sandbox.left.message));
	}
	if (sandbox.right.error) {
		return toMediaImportAdapterSummary(sourceFetchFailure(sandbox.right.error.message));
	}

	return yield* Activity.make({
		error: IntegrationRunError,
		success: MediaImportAdapterSummarySchema,
		name: "build-youtube-music-adapter-result",
		execute: buildYoutubeMusicAdapterResult(
			{
				userId: integration.userId,
				integrationId: integration.id,
				timezone: credentials.timezone,
			},
			sandbox.right.value,
		).pipe(
			Effect.mapError(toIntegrationWorkflowError),
			Effect.flatMap((adapterResult) =>
				storeImportAdapterResult({ runId, adapterResult }).pipe(
					Effect.as(toMediaImportAdapterSummary(adapterResult)),
				),
			),
		),
	});
});

const processYoutubeMusicYank = Effect.fn("processYoutubeMusicYank")(function* (
	integration: IntegrationRecord,
	payload: IntegrationRunJobData,
	executionId: string,
	credentials: { authCookie: string; timezone: string },
) {
	const summary = yield* buildYoutubeMusicImportResult(
		integration,
		payload.runId,
		executionId,
		credentials,
	);

	if (summary.groups === 0 && summary.failures.length > 0) {
		yield* failRunWithAdapterFailures(
			"record-youtube-music-source-fetch-failure",
			payload.runId,
			summary.failures,
		);
		return;
	}

	yield* runMediaImportForIntegration(integration, payload, executionId);
});

const loadYankMediaAdapterResult = (
	integration: IntegrationRecord,
	runId: IntegrationRunJobData["runId"],
) =>
	Effect.gen(function* () {
		const operations = yield* IntegrationRunOperations;

		return yield* Activity.make({
			name: "load-media-import-adapter-result",
			success: IntegrationMediaLoadOutcome,
			execute: operations.loadYankAdapterResult(integration).pipe(
				Effect.flatMap((loaded) =>
					storeImportAdapterResult({ runId, adapterResult: loaded.adapterResult }).pipe(
						Effect.as({
							_tag: "loaded" as const,
							cleanupPaths: [...loaded.cleanupPaths],
							summary: toMediaImportAdapterSummary(loaded.adapterResult),
						}),
					),
				),
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
	});

const processYankMedia = Effect.fn("processYankMedia")(function* (
	integration: IntegrationRecord,
	payload: IntegrationRunJobData,
	executionId: string,
) {
	const specs = integration.providerSpecifics;
	if (specs.kind === "youtube_music") {
		yield* processYoutubeMusicYank(integration, payload, executionId, {
			timezone: specs.timezone,
			authCookie: specs.authCookie,
		});
		return;
	}

	if (specs.kind === "audiobookshelf" || specs.kind === "plex_yank" || specs.kind === "komga") {
		const loadOutcome = yield* loadYankMediaAdapterResult(integration, payload.runId);
		if (loadOutcome._tag === "failed") {
			yield* failRun("fail-import-run-on-load-error", payload.runId, loadOutcome.message);
			return;
		}

		yield* runMediaImportForIntegration(integration, payload, executionId);
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

export const processIntegrationMedia = (
	integration: IntegrationRecord,
	payload: IntegrationRunJobData,
	executionId: string,
) =>
	integration.lot === "sink"
		? processSinkMedia(integration, payload, executionId)
		: processYankMedia(integration, payload, executionId);
