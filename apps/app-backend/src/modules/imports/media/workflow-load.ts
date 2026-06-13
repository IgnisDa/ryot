import { Activity } from "@effect/workflow";
import { Cause, Effect, Schema } from "effect";

import { unknownToMessage } from "#lib/errors";
import type { EntitySearchItem } from "#modules/entity-import/population";

import type { ImportRunJobData } from "../jobs";
import { ImportRunError, toWorkflowError } from "../runtime/workflow-helpers";
import { buildNetflixAdapterResult } from "../sources/netflix/processor";
import { MediaImportAdapterResultSchema, type MediaImportAdapterResult } from "./import-processor";
import { LoadedMediaImportAdapterSuccess } from "./source-loaders";
import { activityKey, LoadMediaImportFailed } from "./workflow-shared";
import type { MediaImportWorkflowOperations } from "./workflow-types";

const LoadMediaImportOutcome = Schema.Union(LoadMediaImportFailed, LoadedMediaImportAdapterSuccess);

export const loadMediaAdapterResult = Effect.fn("loadMediaAdapterResult")(function* <
	RLoad,
	RResolve,
	RImport,
	RSearch = never,
	RCleanup = never,
>(input: {
	payload: ImportRunJobData;
	executionId: string;
	operations: MediaImportWorkflowOperations<RLoad, RResolve, RImport, RSearch, RCleanup>;
}) {
	const loadOutcome = yield* Activity.make({
		name: "load-media-import-adapter-result",
		success: LoadMediaImportOutcome,
		execute: input.operations.loadAdapterResult(input.payload).pipe(
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
					fallbackToInitialCleanupPaths: false,
					message: error.message,
					_tag: "failed" as const,
					cleanupPaths: [...error.cleanupPaths],
				}),
			),
			Effect.catchAllCause((cause) =>
				Effect.succeed({
					cleanupPaths: [],
					fallbackToInitialCleanupPaths: true,
					_tag: "failed" as const,
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
					const searchEntities = input.operations.searchEntities;
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
								onFailure: (error) => ({
									error: error.message,
									jobKey: searchJob.jobKey,
									items: [] as ReadonlyArray<EntitySearchItem>,
								}),
								onSuccess: (items) => ({
									error: null,
									jobKey: searchJob.jobKey,
									items,
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
		adapterResult: cloneAdapterResult(adapterResult),
		cleanupPaths: [...loadOutcome.cleanupPaths],
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
