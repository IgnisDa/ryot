import { Activity } from "@effect/workflow";
import { Cause, DateTime, Effect } from "effect";

import { AppConfig } from "#lib/config";
import { DbRunner } from "#lib/db";
import { unknownToMessage } from "#lib/errors";
import { CollectionsService } from "#modules/collections/service";
import { EntitiesRepository } from "#modules/entities/repository";
import { EntitySchemasRepository } from "#modules/entity-schemas/repository";
import { EpisodeResolverService } from "#modules/episode-resolver/service";
import { EventSchemasRepository } from "#modules/event-schemas/repository";
import { EventsService } from "#modules/events/service";

import type { ImportRunJobData } from "./jobs";
import { loadMediaAdapterResult } from "./media/workflow-load";
import { populateMediaEntityGroups } from "./media/workflow-population";
import { resolveMediaEntityGroups } from "./media/workflow-resolution";
import { createProgressReporter } from "./media/workflow-shared";
import type {
	MediaImportWorkflowOperations,
	MediaImportWorkflowOptions,
} from "./media/workflow-types";
import { writeMediaEntityGroups } from "./media/workflow-writing";
import { ImportsRepository } from "./repository";
import { recordImportRunFailure } from "./runtime/failures";
import { resolveImportPath } from "./runtime/files";
import { makeImporterConfig } from "./runtime/importer-config";
import {
	createImportRunLifecycle,
	ImportRunError,
	toWorkflowError,
} from "./runtime/workflow-helpers";

export const runOneTimeMediaImportWorkflow = Effect.fn("runOneTimeMediaImportWorkflow")(function* <
	RLoad,
	RResolve,
	RImport,
	RSearch = never,
	RCleanup = never,
>(
	payload: ImportRunJobData,
	executionId: string,
	operations: MediaImportWorkflowOperations<RLoad, RResolve, RImport, RSearch, RCleanup>,
	options: MediaImportWorkflowOptions = {},
) {
	const runWithDb = yield* DbRunner;
	const repository = yield* ImportsRepository;
	const collections = yield* CollectionsService;
	const entitiesRepository = yield* EntitiesRepository;
	const episodeResolver = yield* EpisodeResolverService;

	const config = yield* AppConfig;
	const initialCleanupPaths = payload.filePath
		? yield* resolveImportPath(payload.filePath, config.tmpDir)
		: [];
	let cleanupPaths: ReadonlyArray<string> = initialCleanupPaths;
	const { cleanupArtifactsBestEffort, failRunAndCleanup } = createImportRunLifecycle(
		payload,
		operations.cleanupArtifacts,
	);
	const mergeCleanupPaths = (paths: ReadonlyArray<string>) => [
		...new Set([...initialCleanupPaths, ...paths]),
	];

	const processWorkflow = Effect.gen(function* () {
		if (!options.skipMarkStarted) {
			const startedAt = yield* DateTime.nowAsDate;
			yield* Activity.make({
				error: ImportRunError,
				name: "mark-import-run-started",
				execute: runWithDb(
					repository.updateRun({ runId: payload.runId, status: "running", startedAt }),
				).pipe(Effect.mapError(toWorkflowError)),
			});
		}

		const loadOutcome = yield* loadMediaAdapterResult({ payload, executionId, operations });
		cleanupPaths =
			loadOutcome._tag === "failed"
				? loadOutcome.fallbackToInitialCleanupPaths
					? mergeCleanupPaths(loadOutcome.cleanupPaths)
					: [...loadOutcome.cleanupPaths]
				: mergeCleanupPaths(loadOutcome.cleanupPaths);

		if (loadOutcome._tag === "failed") {
			yield* failRunAndCleanup({
				cleanupPaths,
				message: loadOutcome.message,
				failureName: "fail-import-run-on-load-error",
				cleanupName: "cleanup-import-artifacts-on-load-failure",
			});
			return;
		}

		const { failures, entityGroups } = loadOutcome.adapterResult;
		const groups = entityGroups.length;
		const adapterFailureCount = failures.length;

		yield* Effect.forEach(
			failures,
			(failure, index) =>
				Activity.make({
					error: ImportRunError,
					name: `record-adapter-failure-${index}`,
					execute: recordImportRunFailure({
						runId: payload.runId,
						message: failure.message,
						itemIndex: failure.itemIndex,
						context: failure.context ?? null,
						sourceLabel: failure.sourceLabel,
						sourceIdentifier: failure.sourceIdentifier,
						stage: failure.stage ?? "input_transformation",
					}).pipe(Effect.mapError(toWorkflowError)),
				}),
			{ discard: true },
		);

		yield* Activity.make({
			error: ImportRunError,
			name: "record-total-items",
			execute: runWithDb(
				repository.updateRun({ runId: payload.runId, totalItems: groups + adapterFailureCount }),
			).pipe(Effect.mapError(toWorkflowError)),
		});

		const reportResolutionProgress = createProgressReporter({
			groups,
			base: 0,
			span: 30,
			runWithDb,
			payload,
			repository,
			phase: "resolving-entities",
		});
		const reportPopulateProgress = createProgressReporter({
			groups,
			base: 30,
			span: 60,
			runWithDb,
			payload,
			repository,
			phase: "populating-entities",
		});

		const resolveFailures = yield* resolveMediaEntityGroups({
			payload,
			runWithDb,
			executionId,
			operations,
			entityGroups,
			entitiesRepository,
			importer: makeImporterConfig(config),
			reportProgress: reportResolutionProgress,
		});

		const { failures: populateFailures, entityIdsByKey } = yield* populateMediaEntityGroups({
			payload,
			runWithDb,
			collections,
			executionId,
			operations,
			entityGroups,
			entitiesRepository,
			reportProgress: reportPopulateProgress,
		});

		const events = yield* EventsService;
		const eventSchemas = yield* EventSchemasRepository;
		const entitySchemas = yield* EntitySchemasRepository;
		const reportWriteProgress = createProgressReporter({
			groups,
			span: 9,
			base: 90,
			runWithDb,
			payload,
			repository,
			phase: "writing-events",
		});
		const { failures: writeFailures, importedItems } = yield* writeMediaEntityGroups({
			events,
			payload,
			options,
			runWithDb,
			collections,
			executionId,
			entityGroups,
			eventSchemas,
			entitySchemas,
			episodeResolver,
			entityIdsByKey,
			reportProgress: reportWriteProgress,
		});

		const failedItems = adapterFailureCount + resolveFailures + populateFailures + writeFailures;
		const processedItems = adapterFailureCount + groups;

		const finishedAt = yield* DateTime.nowAsDate;
		yield* Activity.make({
			error: ImportRunError,
			name: "finalize-import-run",
			execute: runWithDb(
				repository.updateRun({
					finishedAt,
					failedItems,
					progress: 100,
					importedItems,
					processedItems,
					status: "completed",
					runId: payload.runId,
				}),
			).pipe(Effect.mapError(toWorkflowError)),
		});

		yield* cleanupArtifactsBestEffort("cleanup-import-artifacts-on-success", cleanupPaths);
	});

	yield* processWorkflow.pipe(
		Effect.catchAllCause((cause) =>
			failRunAndCleanup({
				failureName: "fail-import-run-unexpected",
				message: unknownToMessage(Cause.squash(cause)),
				cleanupName: "cleanup-import-artifacts-on-unexpected-failure",
				cleanupPaths: cleanupPaths.length > 0 ? cleanupPaths : initialCleanupPaths,
			}),
		),
	);
});
