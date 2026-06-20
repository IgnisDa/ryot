import type { FileSystem } from "@effect/platform";
import { Activity } from "@effect/workflow";
import type { WorkflowEngine, WorkflowInstance } from "@effect/workflow/WorkflowEngine";
import { unknownToMessage } from "@ryot/contract/errors";
import type { ImportRunFailureStage } from "@ryot/contract/modules/imports/types";
import { Cause, Context, DateTime, Effect, Schema } from "effect";

import { AppConfig } from "#lib/config/service";
import { DbRunner } from "#lib/db/service";
import type { EntitiesRepository } from "#modules/entities/repository";
import type { EntitiesService } from "#modules/entities/service";
import type { EntitySchemasRepository } from "#modules/entity-schemas/repository";
import type { EventSchemasRepository } from "#modules/event-schemas/repository";
import type { EventsService } from "#modules/events/service";

import type { ImportRunJobData } from "./jobs";
import { ImportsRepository } from "./repository";
import {
	readImportFile,
	resolveImportPath,
	resolveSafeImportFilePath,
} from "./runtime/import-files";
import {
	markImportRunStarted,
	PROGRESS_UPDATE_INTERVAL,
	recordImportRunFailure,
} from "./runtime/import-run-status";
import { getKnownImportExtensions } from "./runtime/source-definitions";
import {
	createImportRunLifecycle,
	ImportRunError,
	toWorkflowError,
} from "./runtime/workflow-helpers";

const NonMediaAdapterFailureSchema = Schema.Struct({
	message: Schema.String,
	itemIndex: Schema.Number,
	sourceLabel: Schema.String,
	sourceIdentifier: Schema.String,
});

export type NonMediaAdapterFailure = typeof NonMediaAdapterFailureSchema.Type;

export type NonMediaImportItem = {
	itemIndex: number;
	sourceLabel: string;
	sourceIdentifier: string;
};

export type NonMediaLoadError = {
	message: string;
	cleanupPaths: ReadonlyArray<string>;
};

export type NonMediaItemOutcome =
	| { _tag: "imported" }
	| {
			_tag: "failed";
			message: string;
			stage: ImportRunFailureStage;
			entitySchemaSlug?: string;
	  };

export type NonMediaWriteItem<Item, R> = (input: {
	item: Item;
	index: number;
}) => Effect.Effect<NonMediaItemOutcome, never, R>;

export type NonMediaPrepareResult<Item, R> =
	| { _tag: "failed"; message: string }
	| { _tag: "ready"; writeItem: NonMediaWriteItem<Item, R> };

export type NonMediaPrepareWritesEffect<Item, RWrite, RPrepare> = Effect.Effect<
	NonMediaPrepareResult<Item, RWrite>,
	ImportRunError,
	RPrepare
>;

export type NonMediaImportOperations<Item extends NonMediaImportItem, RLoad, RPrepare, RWrite> = {
	itemSchema: Schema.Schema<Item>;
	loadAdapterResult: (payload: ImportRunJobData) => Effect.Effect<
		{
			items: ReadonlyArray<Item>;
			cleanupPaths: ReadonlyArray<string>;
			failures: ReadonlyArray<NonMediaAdapterFailure>;
		},
		NonMediaLoadError,
		RLoad
	>;
	prepareWrites: (payload: ImportRunJobData) => NonMediaPrepareWritesEffect<Item, RWrite, RPrepare>;
};

type NonMediaImportRequirements =
	| DbRunner
	| AppConfig
	| FileSystem.FileSystem
	| EventsService
	| EntitiesService
	| EntitiesRepository
	| WorkflowEngine
	| WorkflowInstance
	| EventSchemasRepository
	| EntitySchemasRepository;

export type NonMediaImportOperationSet = {
	withOperations: <A, E, R>(
		run: <Item extends NonMediaImportItem>(
			operations: NonMediaImportOperations<
				Item,
				NonMediaImportRequirements,
				NonMediaImportRequirements,
				NonMediaImportRequirements
			>,
		) => Effect.Effect<A, E, R>,
	) => Effect.Effect<A, E, R>;
};

export const makeNonMediaImportOperationSet = <Item extends NonMediaImportItem>(
	operations: NonMediaImportOperations<
		Item,
		NonMediaImportRequirements,
		NonMediaImportRequirements,
		NonMediaImportRequirements
	>,
): NonMediaImportOperationSet => ({
	withOperations: (run) => run(operations),
});

export class NonMediaImportWorkflowOperations extends Context.Tag(
	"NonMediaImportWorkflowOperations",
)<
	NonMediaImportWorkflowOperations,
	{
		getOperations: (
			payload: ImportRunJobData,
		) => Effect.Effect<NonMediaImportOperationSet, ImportRunError>;
	}
>() {}

export const loadNonMediaImportText = Effect.fn("importsNonMedia.loadNonMediaImportText")(
	function* (payload: ImportRunJobData) {
		if (!payload.filePath) {
			return yield* Effect.fail({
				cleanupPaths: [] as ReadonlyArray<string>,
				message: "Import job is missing file path",
			} satisfies NonMediaLoadError);
		}

		const config = yield* AppConfig;
		const safePath = yield* resolveSafeImportFilePath(payload.filePath, config.tmpDir).pipe(
			Effect.mapError(
				() =>
					({
						cleanupPaths: [],
						message: "Import job has an invalid file path",
					}) satisfies NonMediaLoadError,
			),
		);

		yield* validateImportExtension(safePath).pipe(
			Effect.mapError(
				() =>
					({
						cleanupPaths: [safePath],
						message: "Import job has an invalid file extension",
					}) satisfies NonMediaLoadError,
			),
		);

		const text = yield* readImportFile(safePath).pipe(
			Effect.mapError(
				() =>
					({
						cleanupPaths: [safePath],
						message: "Could not read import file",
					}) satisfies NonMediaLoadError,
			),
		);

		return { text, cleanupPaths: [safePath] as ReadonlyArray<string> };
	},
);

const validateImportExtension = (filePath: string): Effect.Effect<void, string> => {
	const segment = filePath.split(/[\\/]/).pop() ?? "";
	const dotIndex = segment.lastIndexOf(".");
	const ext = dotIndex > 0 ? segment.slice(dotIndex + 1).toLowerCase() : "";
	return getKnownImportExtensions().includes(ext) ? Effect.void : Effect.fail("invalid extension");
};

const makeLoadOutcomeSchema = <Item>(itemSchema: Schema.Schema<Item>) =>
	Schema.Union(
		Schema.TaggedStruct("failed", {
			message: Schema.String,
			fallbackToInitialCleanupPaths: Schema.Boolean,
			cleanupPaths: Schema.Array(Schema.String),
		}),
		Schema.TaggedStruct("loaded", {
			items: Schema.Array(itemSchema),
			cleanupPaths: Schema.Array(Schema.String),
			failures: Schema.Array(NonMediaAdapterFailureSchema),
		}),
	);

export const runOneTimeNonMediaImportWorkflow = Effect.fn("runOneTimeNonMediaImportWorkflow")(
	function* (payload: ImportRunJobData) {
		const config = yield* AppConfig;
		const runWithDb = yield* DbRunner;
		const repository = yield* ImportsRepository;
		const operationsService = yield* NonMediaImportWorkflowOperations;

		const initialCleanupPaths = payload.filePath
			? yield* resolveImportPath(payload.filePath, config.tmpDir)
			: [];
		let cleanupPaths: ReadonlyArray<string> = initialCleanupPaths;
		const { cleanupArtifactsBestEffort, failRunAndCleanup } = createImportRunLifecycle(payload);
		const mergeCleanupPaths = (paths: ReadonlyArray<string>) => [
			...new Set([...initialCleanupPaths, ...paths]),
		];

		const processWorkflow = Effect.gen(function* () {
			const operationSet = yield* operationsService.getOperations(payload);
			yield* operationSet.withOperations((operations) =>
				Effect.gen(function* () {
					yield* Activity.make({
						error: ImportRunError,
						name: "mark-import-run-started",
						execute: markImportRunStarted(payload.runId).pipe(Effect.mapError(toWorkflowError)),
					});

					const loadOutcome = yield* Activity.make({
						name: "load-non-media-import-adapter-result",
						success: makeLoadOutcomeSchema(operations.itemSchema),
						execute: operations.loadAdapterResult(payload).pipe(
							Effect.map(({ items, failures, cleanupPaths: loadedCleanupPaths }) => ({
								items: [...items],
								_tag: "loaded" as const,
								failures: [...failures],
								cleanupPaths: [...loadedCleanupPaths],
							})),
							Effect.catchAll((error) =>
								Effect.succeed({
									_tag: "failed" as const,
									message: error.message,
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

					const items = loadOutcome.items;
					const adapterFailureCount = loadOutcome.failures.length;
					const totalItems = items.length + adapterFailureCount;

					yield* Effect.forEach(
						loadOutcome.failures,
						(failure, index) =>
							Activity.make({
								error: ImportRunError,
								name: `record-adapter-failure-${index}`,
								execute: recordImportRunFailure({
									runId: payload.runId,
									message: failure.message,
									itemIndex: failure.itemIndex,
									stage: "input_transformation",
									sourceLabel: failure.sourceLabel,
									sourceIdentifier: failure.sourceIdentifier,
								}).pipe(Effect.mapError(toWorkflowError)),
							}),
						{ discard: true },
					);

					yield* Activity.make({
						error: ImportRunError,
						name: "record-total-items",
						execute: runWithDb(repository.updateRun({ runId: payload.runId, totalItems })).pipe(
							Effect.mapError(toWorkflowError),
						),
					});

					const prepared = yield* operations.prepareWrites(payload);
					if (prepared._tag === "failed") {
						yield* failRunAndCleanup({
							cleanupPaths,
							message: prepared.message,
							failureName: "fail-import-run-on-prepare-error",
							cleanupName: "cleanup-import-artifacts-on-prepare-failure",
						});
						return;
					}

					let importedItems = 0;
					let failedItems = adapterFailureCount;
					let processedItems = adapterFailureCount;

					for (let i = 0; i < items.length; i += 1) {
						const item = items[i];
						if (!item) {
							continue;
						}

						const outcome = yield* prepared.writeItem({ item, index: i });
						if (outcome._tag === "failed") {
							failedItems += 1;
							yield* Activity.make({
								error: ImportRunError,
								name: `record-item-failure-${i}`,
								execute: recordImportRunFailure({
									runId: payload.runId,
									stage: outcome.stage,
									message: outcome.message,
									itemIndex: item.itemIndex,
									sourceLabel: item.sourceLabel,
									sourceIdentifier: item.sourceIdentifier,
									entitySchemaSlug: outcome.entitySchemaSlug ?? null,
								}).pipe(Effect.mapError(toWorkflowError)),
							});
						} else {
							importedItems += 1;
						}

						processedItems += 1;
						if (processedItems % PROGRESS_UPDATE_INTERVAL === 0 || processedItems === totalItems) {
							const progress =
								totalItems > 0 ? Math.round((processedItems / totalItems) * 100) : 100;
							yield* Activity.make({
								error: ImportRunError,
								name: `report-progress-${processedItems}`,
								execute: runWithDb(
									repository.updateRun({
										progress,
										failedItems,
										importedItems,
										processedItems,
										runId: payload.runId,
									}),
								).pipe(Effect.mapError(toWorkflowError)),
							});
						}
					}

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
				}),
			);
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
	},
);
