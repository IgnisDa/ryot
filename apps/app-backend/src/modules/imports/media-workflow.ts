import { Activity } from "@effect/workflow";
import { unknownToMessage } from "@ryot/contract/errors";
import { Cause, DateTime, Effect } from "effect";

import { AppConfig } from "#lib/config/service";
import { DbRunner } from "#lib/db/service";

import type { ImportRunJobData } from "./jobs";
import type { MediaImportAdapterResult } from "./media/adapter-result";
import { loadMediaAdapterResult } from "./media/load-workflow";
import { populateMediaEntityGroups } from "./media/population-workflow";
import { resolveMediaEntityGroups } from "./media/resolution-workflow";
import { createProgressReporter } from "./media/shared-workflow";
import type { ImportMediaEntityGroup } from "./media/types";
import type { MediaImportWorkflowOptions } from "./media/types-workflow";
import { writeMediaEntityGroups } from "./media/writing-workflow";
import { ImportsRepository } from "./repository";
import { resolveImportPath } from "./runtime/import-files";
import { markImportRunStarted, recordImportRunFailure } from "./runtime/import-run-status";
import {
	createImportRunLifecycle,
	ImportRunError,
	toWorkflowError,
} from "./runtime/workflow-helpers";

const cloneMediaEntityGroups = (
	adapterResult: MediaImportAdapterResult,
): ImportMediaEntityGroup[] =>
	adapterResult.entityGroups.map((group) => ({
		...group,
		events: [...group.events],
		entityRef: { ...group.entityRef },
		collectionMemberships: [...group.collectionMemberships],
	}));

const recordMediaAdapterFailures = (
	payload: ImportRunJobData,
	failures: MediaImportAdapterResult["failures"],
) =>
	Effect.forEach(
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

const recordMediaTotalItems = (payload: ImportRunJobData, totalItems: number) =>
	Effect.gen(function* () {
		const runWithDb = yield* DbRunner;
		const repository = yield* ImportsRepository;

		yield* Activity.make({
			error: ImportRunError,
			name: "record-total-items",
			execute: runWithDb(repository.updateRun({ runId: payload.runId, totalItems })).pipe(
				Effect.mapError(toWorkflowError),
			),
		});
	});

const makeMediaProgressReporters = (input: { groups: number; payload: ImportRunJobData }) => ({
	resolution: createProgressReporter({
		base: 0,
		span: 30,
		phase: "resolving-entities",
		groups: input.groups,
		payload: input.payload,
	}),
	population: createProgressReporter({
		base: 30,
		span: 60,
		phase: "populating-entities",
		groups: input.groups,
		payload: input.payload,
	}),
	writing: createProgressReporter({
		base: 90,
		span: 9,
		phase: "writing-events",
		groups: input.groups,
		payload: input.payload,
	}),
});

const finalizeMediaImportRun = (input: {
	failedItems: number;
	importedItems: number;
	processedItems: number;
	payload: ImportRunJobData;
}) =>
	Effect.gen(function* () {
		const runWithDb = yield* DbRunner;
		const repository = yield* ImportsRepository;
		const finishedAt = yield* DateTime.nowAsDate;

		yield* Activity.make({
			error: ImportRunError,
			name: "finalize-import-run",
			execute: runWithDb(
				repository.updateRun({
					finishedAt,
					progress: 100,
					status: "completed",
					runId: input.payload.runId,
					failedItems: input.failedItems,
					importedItems: input.importedItems,
					processedItems: input.processedItems,
				}),
			).pipe(Effect.mapError(toWorkflowError)),
		});
	});

const cleanupMediaImportRun = (input: {
	payload: ImportRunJobData;
	cleanupOnSuccess?: boolean;
	cleanupPaths: ReadonlyArray<string>;
}) => {
	if (input.cleanupOnSuccess === false) {
		return Effect.void;
	}

	const { cleanupArtifactsBestEffort } = createImportRunLifecycle(input.payload);
	return cleanupArtifactsBestEffort("cleanup-import-artifacts-on-success", input.cleanupPaths);
};

const mergeCleanupPaths = (
	initialCleanupPaths: ReadonlyArray<string>,
	loadedCleanupPaths: ReadonlyArray<string>,
) => [...new Set([...initialCleanupPaths, ...loadedCleanupPaths])];

export const runLoadedMediaImportWorkflow = Effect.fn("runLoadedMediaImportWorkflow")(
	function* (input: {
		executionId: string;
		payload: ImportRunJobData;
		cleanupOnSuccess?: boolean;
		options?: MediaImportWorkflowOptions;
		cleanupPaths?: ReadonlyArray<string>;
		adapterResult: MediaImportAdapterResult;
	}) {
		const options = input.options ?? {};
		const { failures } = input.adapterResult;
		const cleanupPaths = input.cleanupPaths ?? [];
		const entityGroups = cloneMediaEntityGroups(input.adapterResult);
		const groups = entityGroups.length;
		const adapterFailureCount = failures.length;
		const progress = makeMediaProgressReporters({ groups, payload: input.payload });

		yield* recordMediaAdapterFailures(input.payload, failures);
		yield* recordMediaTotalItems(input.payload, groups + adapterFailureCount);

		const resolveFailures = yield* resolveMediaEntityGroups({
			entityGroups,
			payload: input.payload,
			executionId: input.executionId,
			reportProgress: progress.resolution,
		});

		const { failures: populateFailures, entityIdsByKey } = yield* populateMediaEntityGroups({
			entityGroups,
			payload: input.payload,
			executionId: input.executionId,
			reportProgress: progress.population,
		});

		const { failures: writeFailures, importedItems } = yield* writeMediaEntityGroups({
			options,
			entityGroups,
			entityIdsByKey,
			payload: input.payload,
			executionId: input.executionId,
			reportProgress: progress.writing,
		});

		const failedItems = adapterFailureCount + resolveFailures + populateFailures + writeFailures;
		const processedItems = adapterFailureCount + groups;

		yield* finalizeMediaImportRun({
			failedItems,
			importedItems,
			processedItems,
			payload: input.payload,
		});
		yield* cleanupMediaImportRun({
			cleanupPaths,
			payload: input.payload,
			cleanupOnSuccess: input.cleanupOnSuccess,
		});
	},
);

export const runOneTimeMediaImportWorkflow = Effect.fn("runOneTimeMediaImportWorkflow")(function* (
	payload: ImportRunJobData,
	executionId: string,
	options: MediaImportWorkflowOptions = {},
) {
	const config = yield* AppConfig;
	const initialCleanupPaths = payload.filePath
		? yield* resolveImportPath(payload.filePath, config.tmpDir)
		: [];
	let cleanupPaths: ReadonlyArray<string> = initialCleanupPaths;
	const { failRunAndCleanup } = createImportRunLifecycle(payload);

	const processWorkflow = Effect.gen(function* () {
		yield* Activity.make({
			error: ImportRunError,
			name: "mark-import-run-started",
			execute: markImportRunStarted(payload.runId).pipe(Effect.mapError(toWorkflowError)),
		});

		const loadOutcome = yield* loadMediaAdapterResult({ payload, executionId });
		if (loadOutcome._tag === "failed" && !loadOutcome.fallbackToInitialCleanupPaths) {
			cleanupPaths = [...loadOutcome.cleanupPaths];
		} else {
			cleanupPaths = mergeCleanupPaths(initialCleanupPaths, loadOutcome.cleanupPaths);
		}

		if (loadOutcome._tag === "failed") {
			yield* failRunAndCleanup({
				cleanupPaths,
				message: loadOutcome.message,
				failureName: "fail-import-run-on-load-error",
				cleanupName: "cleanup-import-artifacts-on-load-failure",
			});
			return;
		}

		yield* runLoadedMediaImportWorkflow({
			payload,
			options,
			executionId,
			cleanupPaths,
			adapterResult: loadOutcome.adapterResult,
		});
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
