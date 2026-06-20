import { Activity } from "@effect/workflow";
import { Effect, Layer, Schema } from "effect";

import type { ImportRunJobData } from "../jobs";
import { recordImportRunFailure } from "../runtime/import-run-status";
import {
	AdapterManifest,
	loadImportAdapterChunk,
	loadImportAdapterManifest,
} from "../runtime/source-payload-store";
import {
	finalizeImportRun,
	ImportRunError,
	recordImportTotalItems,
	toWorkflowError,
} from "../runtime/workflow-helpers";
import type { MediaImportAdapterResult } from "./adapter-result";
import {
	ProcessNormalizedMediaImportWorkflow,
	type NormalizedMediaImportJobData,
} from "./normalized-import-workflow";
import { MediaImportWorkflowOperationsLive } from "./operations-workflow";
import { populateMediaEntityGroups } from "./population-workflow";
import { resolveMediaEntityGroups } from "./resolution-workflow";
import { createProgressReporter } from "./shared-workflow";
import { ImportMediaEntityGroupSchema, type ImportMediaEntityGroup } from "./types";
import type { MediaImportWorkflowOptions } from "./types-workflow";
import { writeMediaEntityGroups } from "./writing-workflow";

const cloneMediaEntityGroups = (
	groups: ReadonlyArray<typeof ImportMediaEntityGroupSchema.Type>,
): ImportMediaEntityGroup[] =>
	groups.map((group) => ({
		...group,
		events: [...group.events],
		entityRef: { ...group.entityRef },
		collectionMemberships: [...group.collectionMemberships],
	}));

const loadNormalizedAdapterManifest = (runId: string) =>
	Activity.make({
		error: ImportRunError,
		success: AdapterManifest,
		name: "load-normalized-adapter-manifest",
		execute: loadImportAdapterManifest(runId).pipe(
			Effect.flatMap((result) =>
				result === null
					? new ImportRunError({
							message: "Normalized media import artifact is missing or expired",
						})
					: Effect.succeed(result),
			),
		),
	});

const loadNormalizedAdapterChunk = (runId: string, chunkIndex: number) =>
	Activity.make({
		error: ImportRunError,
		name: `load-normalized-adapter-chunk-${chunkIndex}`,
		success: Schema.Array(ImportMediaEntityGroupSchema),
		execute: loadImportAdapterChunk(runId, chunkIndex).pipe(
			Effect.flatMap((result) =>
				result === null
					? new ImportRunError({
							message: `Normalized media import chunk ${chunkIndex} is missing or expired`,
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

export const processNormalizedMediaImport = Effect.fn("processNormalizedMediaImport")(function* (
	payload: NormalizedMediaImportJobData,
	executionId: string,
) {
	const jobData: Pick<ImportRunJobData, "runId" | "userId"> = {
		runId: payload.runId,
		userId: payload.userId,
	};
	const options: MediaImportWorkflowOptions = payload.integrationId
		? { integrationId: payload.integrationId }
		: {};
	const origin = payload.integrationId
		? {
				importRunId: payload.runId,
				kind: "integration" as const,
				integrationId: payload.integrationId,
			}
		: { kind: "import" as const, importRunId: payload.runId };

	const manifest = yield* loadNormalizedAdapterManifest(payload.runId);
	const { failures, groups } = manifest;
	const adapterFailureCount = failures.length;
	const progress = makeMediaProgressReporters({ groups, payload: jobData });

	yield* recordMediaAdapterFailures(jobData, failures);
	yield* recordImportTotalItems(jobData, groups + adapterFailureCount);

	let resolveFailures = 0;
	let populateFailures = 0;
	let writeFailures = 0;
	let importedItems = 0;
	for (let chunkIndex = 0; chunkIndex < manifest.chunkCount; chunkIndex += 1) {
		const chunk = yield* loadNormalizedAdapterChunk(payload.runId, chunkIndex);
		const entityGroups = cloneMediaEntityGroups(chunk);
		const chunkExecutionId = `${executionId}-chunk-${chunkIndex}`;
		resolveFailures += yield* resolveMediaEntityGroups({
			entityGroups,
			payload: jobData,
			executionId: chunkExecutionId,
			reportProgress: progress.resolution,
		});
		const populated = yield* populateMediaEntityGroups({
			origin,
			entityGroups,
			payload: jobData,
			executionId: chunkExecutionId,
			reportProgress: progress.population,
		});
		populateFailures += populated.failures;
		const written = yield* writeMediaEntityGroups({
			options,
			entityGroups,
			payload: jobData,
			executionId: chunkExecutionId,
			reportProgress: progress.writing,
			entityIdsByKey: populated.entityIdsByKey,
		});
		writeFailures += written.failures;
		importedItems += written.importedItems;
	}

	const failedItems = adapterFailureCount + resolveFailures + populateFailures + writeFailures;
	const processedItems = adapterFailureCount + groups;

	yield* finalizeImportRun({
		failedItems,
		importedItems,
		processedItems,
		payload: jobData,
	});
});

const ProcessNormalizedMediaImportWorkflowLive = ProcessNormalizedMediaImportWorkflow.toLayer(
	(payload, executionId) => processNormalizedMediaImport(payload, executionId),
);

export const ProcessNormalizedMediaImportWorkflowDefinitionsLive =
	ProcessNormalizedMediaImportWorkflowLive.pipe(Layer.provide(MediaImportWorkflowOperationsLive));
