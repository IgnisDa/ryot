import { Activity } from "@effect/workflow";
import { unknownToMessage } from "@ryot/contract/errors";
import { Cause, DateTime, Effect } from "effect";

import { AppConfig } from "#lib/config/service";
import { DbRunner } from "#lib/db/service";

import type { ImportRunJobData } from "./jobs";
import type { MediaImportAdapterResult } from "./media/adapter-result";
import { loadMediaAdapterResult } from "./media/workflow-load";
import { populateMediaEntityGroups } from "./media/workflow-population";
import { resolveMediaEntityGroups } from "./media/workflow-resolution";
import { createProgressReporter } from "./media/workflow-shared";
import type { MediaImportWorkflowOptions } from "./media/workflow-types";
import { writeMediaEntityGroups } from "./media/workflow-writing";
import { ImportsRepository } from "./repository";
import { resolveImportPath } from "./runtime/import-files";
import { markImportRunStarted, recordImportRunFailure } from "./runtime/import-run-status";
import {
	createImportRunLifecycle,
	ImportRunError,
	toWorkflowError,
} from "./runtime/workflow-helpers";

export const runLoadedMediaImportWorkflow = Effect.fn("runLoadedMediaImportWorkflow")(
	function* (input: {
		executionId: string;
		payload: ImportRunJobData;
		cleanupOnSuccess?: boolean;
		options?: MediaImportWorkflowOptions;
		cleanupPaths?: ReadonlyArray<string>;
		adapterResult: MediaImportAdapterResult;
	}) {
		const runWithDb = yield* DbRunner;
		const options = input.options ?? {};
		const { failures } = input.adapterResult;
		const repository = yield* ImportsRepository;
		const cleanupPaths = input.cleanupPaths ?? [];
		const entityGroups = input.adapterResult.entityGroups.map((group) => ({
			...group,
			events: [...group.events],
			entityRef: { ...group.entityRef },
			collectionMemberships: [...group.collectionMemberships],
		}));
		const groups = entityGroups.length;
		const adapterFailureCount = failures.length;

		yield* Effect.forEach(
			failures,
			(failure, index) =>
				Activity.make({
					error: ImportRunError,
					name: `record-adapter-failure-${index}`,
					execute: recordImportRunFailure({
						runId: input.payload.runId,
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
				repository.updateRun({
					runId: input.payload.runId,
					totalItems: groups + adapterFailureCount,
				}),
			).pipe(Effect.mapError(toWorkflowError)),
		});

		const reportResolutionProgress = createProgressReporter({
			groups,
			base: 0,
			span: 30,
			payload: input.payload,
			phase: "resolving-entities",
		});
		const reportPopulateProgress = createProgressReporter({
			groups,
			base: 30,
			span: 60,
			payload: input.payload,
			phase: "populating-entities",
		});

		const resolveFailures = yield* resolveMediaEntityGroups({
			payload: input.payload,
			executionId: input.executionId,
			entityGroups,
			reportProgress: reportResolutionProgress,
		});

		const { failures: populateFailures, entityIdsByKey } = yield* populateMediaEntityGroups({
			payload: input.payload,
			executionId: input.executionId,
			entityGroups,
			reportProgress: reportPopulateProgress,
		});

		const reportWriteProgress = createProgressReporter({
			groups,
			span: 9,
			base: 90,
			payload: input.payload,
			phase: "writing-events",
		});
		const { failures: writeFailures, importedItems } = yield* writeMediaEntityGroups({
			payload: input.payload,
			options,
			executionId: input.executionId,
			entityGroups,
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
					runId: input.payload.runId,
				}),
			).pipe(Effect.mapError(toWorkflowError)),
		});

		if (input.cleanupOnSuccess !== false) {
			const { cleanupArtifactsBestEffort } = createImportRunLifecycle(input.payload);
			yield* cleanupArtifactsBestEffort("cleanup-import-artifacts-on-success", cleanupPaths);
		}
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
	const mergeCleanupPaths = (paths: ReadonlyArray<string>) => [
		...new Set([...initialCleanupPaths, ...paths]),
	];

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
			cleanupPaths = mergeCleanupPaths(loadOutcome.cleanupPaths);
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
