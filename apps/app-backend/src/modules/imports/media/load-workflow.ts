import { Activity } from "@effect/workflow";
import { unknownToMessage } from "@ryot/contract/errors";
import { Cause, Effect, Schema } from "effect";

import type { RedisService } from "#lib/infrastructure/redis";
import type { EntitySearchItem } from "#modules/entity-import/population";

import type { ImportRunJobData } from "../jobs";
import { storeImportAdapterResult } from "../runtime/source-payload-store";
import { ImportRunError, toWorkflowError } from "../runtime/workflow-errors";
import { buildNetflixAdapterResult } from "../sources/netflix/processor";
import { MediaImportAdapterSummarySchema, toMediaImportAdapterSummary } from "./adapter-result";
import { activityKey, LoadMediaImportFailed } from "./shared-workflow";
import { LoadedMediaImportAdapterNetflixSearchPlanned } from "./source-loaders";
import { MediaImportWorkflowOperations } from "./types-workflow";

const LoadMediaImportLoaded = Schema.TaggedStruct("loaded", {
	cleanupPaths: Schema.Array(Schema.String),
	summary: MediaImportAdapterSummarySchema,
});

const LoadMediaImportActivityOutcome = Schema.Union(
	LoadMediaImportFailed,
	LoadMediaImportLoaded,
	LoadedMediaImportAdapterNetflixSearchPlanned,
);

type LoadMediaImportActivityOutcome = typeof LoadMediaImportActivityOutcome.Type;

export const loadMediaAdapterResult = Effect.fn("loadMediaAdapterResult")(function* (input: {
	payload: ImportRunJobData;
	executionId: string;
}) {
	const operations = yield* MediaImportWorkflowOperations;
	const loadOutcome = yield* Activity.make({
		success: LoadMediaImportActivityOutcome,
		name: "load-media-import-adapter-result",
		execute: operations.loadAdapterResult(input.payload).pipe(
			Effect.flatMap(
				(loaded): Effect.Effect<LoadMediaImportActivityOutcome, never, RedisService> => {
					if ("_tag" in loaded && loaded._tag === "netflix-search-planned") {
						return Effect.succeed({ ...loaded, cleanupPaths: [...loaded.cleanupPaths] });
					}
					return storeImportAdapterResult({
						runId: input.payload.runId,
						adapterResult: loaded.adapterResult,
					}).pipe(
						Effect.as({
							_tag: "loaded" as const,
							cleanupPaths: [...loaded.cleanupPaths],
							summary: toMediaImportAdapterSummary(loaded.adapterResult),
						}),
					);
				},
			),
			Effect.catchAll((error) =>
				Effect.succeed({
					message: error.message,
					_tag: "failed" as const,
					fallbackToInitialCleanupPaths: false,
					cleanupPaths: [...error.cleanupPaths],
				}),
			),
			Effect.catchAllCause((cause) =>
				Effect.succeed({
					cleanupPaths: [],
					_tag: "failed" as const,
					fallbackToInitialCleanupPaths: true,
					message: unknownToMessage(Cause.squash(cause)),
				}),
			),
		),
	});

	if (loadOutcome._tag === "failed") {
		return loadOutcome;
	}

	if (loadOutcome._tag === "loaded") {
		return loadOutcome;
	}

	const searchEntities = operations.searchEntities;
	if (!searchEntities) {
		return yield* new ImportRunError({
			message: "Netflix search planning requires a workflow-owned search operation",
		});
	}

	const searchResponses = yield* Effect.forEach(loadOutcome.searchJobs, (searchJob) =>
		searchEntities({
			query: searchJob.query,
			userId: input.payload.userId,
			scriptId: searchJob.scriptId,
			executionId: `${input.executionId}-search-${activityKey(searchJob.jobKey)}`,
		}).pipe(
			Effect.match({
				onSuccess: (items) => ({ items, error: null, jobKey: searchJob.jobKey }),
				onFailure: (error) => ({
					error: error.message,
					jobKey: searchJob.jobKey,
					items: [] as ReadonlyArray<EntitySearchItem>,
				}),
			}),
		),
	);

	const summary = yield* Activity.make({
		error: ImportRunError,
		name: "build-netflix-adapter-result",
		success: MediaImportAdapterSummarySchema,
		execute: buildNetflixAdapterResult({
			searchResponses,
			importedAt: loadOutcome.importedAt,
			myListPath: loadOutcome.myListPath,
			profileName: loadOutcome.profileName,
			ratingsPath: loadOutcome.ratingsPath,
			viewingActivityPath: loadOutcome.viewingActivityPath,
		}).pipe(
			Effect.mapError(toWorkflowError),
			Effect.flatMap((adapterResult) =>
				storeImportAdapterResult({
					runId: input.payload.runId,
					adapterResult,
				}).pipe(Effect.as(toMediaImportAdapterSummary(adapterResult))),
			),
		),
	});

	return {
		_tag: "loaded" as const,
		summary,
		cleanupPaths: [...loadOutcome.cleanupPaths],
	};
});
