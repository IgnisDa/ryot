import { Activity } from "@effect/workflow";
import { unknownToMessage } from "@ryot/contract/errors";
import { Cause, Effect, Schema } from "effect";

import type { EntitySearchItem } from "#modules/entity-import/population";

import type { ImportRunJobData } from "../jobs";
import { ImportRunError, toWorkflowError } from "../runtime/workflow-helpers";
import { buildNetflixAdapterResult } from "../sources/netflix/processor";
import { MediaImportAdapterResultSchema, type MediaImportAdapterResult } from "./adapter-result";
import { activityKey, LoadMediaImportFailed } from "./shared-workflow";
import { LoadedMediaImportAdapterSuccess } from "./source-loaders";
import { MediaImportWorkflowOperations } from "./types-workflow";

const LoadMediaImportOutcome = Schema.Union(LoadMediaImportFailed, LoadedMediaImportAdapterSuccess);

export const loadMediaAdapterResult = Effect.fn("loadMediaAdapterResult")(function* (input: {
	payload: ImportRunJobData;
	executionId: string;
}) {
	const operations = yield* MediaImportWorkflowOperations;
	const loadOutcome = yield* Activity.make({
		success: LoadMediaImportOutcome,
		name: "load-media-import-adapter-result",
		execute: operations.loadAdapterResult(input.payload).pipe(
			Effect.map((loaded) =>
				"_tag" in loaded
					? { ...loaded, cleanupPaths: [...loaded.cleanupPaths] }
					: {
							...loaded,
							_tag: "loaded" as const,
							cleanupPaths: [...loaded.cleanupPaths],
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

	const adapterResult =
		loadOutcome._tag === "netflix-search-planned"
			? yield* Effect.gen(function* () {
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

					return yield* Activity.make({
						error: ImportRunError,
						name: "build-netflix-adapter-result",
						success: MediaImportAdapterResultSchema,
						execute: buildNetflixAdapterResult({
							searchResponses,
							importedAt: loadOutcome.importedAt,
							myListPath: loadOutcome.myListPath,
							profileName: loadOutcome.profileName,
							ratingsPath: loadOutcome.ratingsPath,
							viewingActivityPath: loadOutcome.viewingActivityPath,
						}).pipe(Effect.mapError(toWorkflowError)),
					});
				})
			: loadOutcome.adapterResult;

	return {
		_tag: "loaded" as const,
		cleanupPaths: [...loadOutcome.cleanupPaths],
		adapterResult: cloneAdapterResult(adapterResult),
	};
});

const cloneAdapterResult = (adapterResult: MediaImportAdapterResult) => ({
	failures: adapterResult.failures.map((failure) => ({
		stage: failure.stage,
		message: failure.message,
		itemIndex: failure.itemIndex,
		sourceLabel: failure.sourceLabel,
		sourceIdentifier: failure.sourceIdentifier,
		context: failure.context ? { ...failure.context } : undefined,
	})),
	entityGroups: adapterResult.entityGroups.map((group) => ({
		...group,
		events: [...group.events],
		entityRef: { ...group.entityRef },
		collectionMemberships: [...group.collectionMemberships],
	})),
});
