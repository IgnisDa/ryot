import { Activity } from "@effect/workflow";
import { DateTime, Effect, Layer } from "effect";

import type { ImportRunJobData } from "../jobs";
import { recordImportRunFailure } from "../runtime/import-run-status";
import { loadImportAdapterResult } from "../runtime/source-payload-store";
import { ImportRunError, toWorkflowError } from "../runtime/workflow-errors";
import { ImportsService } from "../service";
import { MediaImportAdapterResultSchema, type MediaImportAdapterResult } from "./adapter-result";
import {
	ProcessNormalizedMediaImportWorkflow,
	type NormalizedMediaImportJobData,
} from "./normalized-import-workflow";
import { MediaImportWorkflowOperationsLive } from "./operations-workflow";
import {
	populateMediaEntityGroupsWithPlugin,
	resolveMediaEntityGroupsWithPlugin,
} from "./plugin-workflows";
import { createProgressReporter } from "./shared-workflow";
import type { ImportMediaEntityGroup } from "./types";
import { writeMediaEntityGroups } from "./writing-workflow";

const cloneMediaEntityGroups = (
	adapterResult: MediaImportAdapterResult,
): ImportMediaEntityGroup[] =>
	adapterResult.entityGroups.map((group) => ({
		...group,
		events: [...group.events],
		entityRef: { ...group.entityRef },
		collectionMemberships: [...group.collectionMemberships],
	}));

const loadNormalizedAdapterResult = (runId: string) =>
	Activity.make({
		error: ImportRunError,
		name: "load-normalized-adapter-result",
		success: MediaImportAdapterResultSchema,
		execute: loadImportAdapterResult(runId).pipe(
			Effect.flatMap((result) =>
				result === null
					? new ImportRunError({
							message: "Normalized media import artifact is missing or expired",
						})
					: Effect.succeed(result),
			),
		),
	});

const recordMediaAdapterFailures = (
	payload: Pick<ImportRunJobData, "runId">,
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

const recordMediaTotalItems = (payload: Pick<ImportRunJobData, "runId">, totalItems: number) =>
	Effect.gen(function* () {
		const imports = yield* ImportsService;

		yield* Activity.make({
			error: ImportRunError,
			name: "record-total-items",
			execute: imports
				.update({ runId: payload.runId, totalItems })
				.pipe(Effect.mapError(toWorkflowError)),
		});
	});

const makeMediaProgressReporters = (input: {
	groups: number;
	payload: Pick<ImportRunJobData, "runId">;
}) => ({
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
	payload: Pick<ImportRunJobData, "runId">;
}) =>
	Effect.gen(function* () {
		const imports = yield* ImportsService;
		const finishedAt = yield* DateTime.nowAsDate;

		yield* Activity.make({
			error: ImportRunError,
			name: "finalize-import-run",
			execute: imports
				.update({
					finishedAt,
					progress: 100,
					status: "completed",
					runId: input.payload.runId,
					failedItems: input.failedItems,
					importedItems: input.importedItems,
					processedItems: input.processedItems,
				})
				.pipe(Effect.mapError(toWorkflowError)),
		});
	});

export const processNormalizedMediaImport = Effect.fn("ProcessNormalizedMediaImportWorkflow")(
	function* (payload: NormalizedMediaImportJobData, executionId: string) {
		yield* Effect.annotateCurrentSpan({
			executionId,
			runId: payload.runId,
			userId: payload.userId,
			...(payload.integrationId ? { integrationId: payload.integrationId } : {}),
		});
		const jobData = {
			runId: payload.runId,
			userId: payload.userId,
			...(payload.integrationId ? { integrationId: payload.integrationId } : {}),
		};

		const adapterResult = yield* loadNormalizedAdapterResult(payload.runId);
		const { failures } = adapterResult;
		const entityGroups = cloneMediaEntityGroups(adapterResult);
		const groups = entityGroups.length;
		const adapterFailureCount = failures.length;
		const progress = makeMediaProgressReporters({ groups, payload: jobData });

		yield* recordMediaAdapterFailures(jobData, failures);
		yield* recordMediaTotalItems(jobData, groups + adapterFailureCount);

		const resolveFailures = yield* resolveMediaEntityGroupsWithPlugin({
			executionId,
			entityGroups,
			payload: jobData,
			reportProgress: progress.resolution,
		});

		const { failures: populateFailures, entityIdsByKey } =
			yield* populateMediaEntityGroupsWithPlugin({
				executionId,
				entityGroups,
				payload: jobData,
				reportProgress: progress.population,
			});

		const { failures: writeFailures, importedItems } = yield* writeMediaEntityGroups({
			executionId,
			entityGroups,
			entityIdsByKey,
			payload: jobData,
			reportProgress: progress.writing,
		});

		const failedItems = adapterFailureCount + resolveFailures + populateFailures + writeFailures;
		const processedItems = adapterFailureCount + groups;

		yield* finalizeMediaImportRun({
			failedItems,
			importedItems,
			processedItems,
			payload: jobData,
		});
	},
	(effect, _payload, executionId) =>
		Effect.annotateLogs(effect, { executionId, workflow: "ProcessNormalizedMediaImportWorkflow" }),
);

const ProcessNormalizedMediaImportWorkflowLive = ProcessNormalizedMediaImportWorkflow.toLayer(
	processNormalizedMediaImport,
);

export const ProcessNormalizedMediaImportWorkflowDefinitionsLive =
	ProcessNormalizedMediaImportWorkflowLive.pipe(Layer.provide(MediaImportWorkflowOperationsLive));
