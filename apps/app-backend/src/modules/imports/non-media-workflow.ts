import type { FileSystem } from "@effect/platform";
import { Activity } from "@effect/workflow";
import type { WorkflowEngine, WorkflowInstance } from "@effect/workflow/WorkflowEngine";
import { unknownToMessage } from "@ryot/contract/errors";
import type { ImportRunFailureStage } from "@ryot/contract/modules/imports/types";
import { Cause, Context, DateTime, Effect, Schema } from "effect";

import { AppConfig } from "#lib/infrastructure/config/service";
import type { DbRunner } from "#lib/infrastructure/db/service";
import type { EntitiesRepository } from "#modules/entities/repository";
import type { EntitiesService } from "#modules/entities/service";
import type { EntitySchemasRepository } from "#modules/entity-schemas/repository";
import type { EventSchemasRepository } from "#modules/event-schemas/repository";
import type { EventsService } from "#modules/events/service";

import type { ImportRunJobData } from "./jobs";
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
import { ImportRunError, toWorkflowError } from "./runtime/workflow-errors";
import { createImportRunLifecycle } from "./runtime/workflow-helpers";
import { ImportsService } from "./service";

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

type NonMediaLoadOutcome<Item> =
	| {
			_tag: "failed";
			message: string;
			fallbackToInitialCleanupPaths: boolean;
			cleanupPaths: ReadonlyArray<string>;
	  }
	| {
			_tag: "loaded";
			items: ReadonlyArray<Item>;
			cleanupPaths: ReadonlyArray<string>;
			failures: ReadonlyArray<NonMediaAdapterFailure>;
	  };

type NonMediaWriteSummary = {
	failedItems: number;
	importedItems: number;
	processedItems: number;
};

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

const mergeCleanupPaths = (
	initialCleanupPaths: ReadonlyArray<string>,
	loadedCleanupPaths: ReadonlyArray<string>,
) => [...new Set([...initialCleanupPaths, ...loadedCleanupPaths])];

const resolveCleanupPaths = <Item>(
	loadOutcome: NonMediaLoadOutcome<Item>,
	initialCleanupPaths: ReadonlyArray<string>,
) =>
	loadOutcome._tag === "failed" && !loadOutcome.fallbackToInitialCleanupPaths
		? [...loadOutcome.cleanupPaths]
		: mergeCleanupPaths(initialCleanupPaths, loadOutcome.cleanupPaths);

const loadNonMediaAdapterResult = <Item extends NonMediaImportItem, RLoad, RPrepare, RWrite>(
	payload: ImportRunJobData,
	operations: NonMediaImportOperations<Item, RLoad, RPrepare, RWrite>,
) =>
	Activity.make({
		name: "load-non-media-import-adapter-result",
		success: makeLoadOutcomeSchema(operations.itemSchema),
		execute: operations.loadAdapterResult(payload).pipe(
			Effect.map(({ items, failures, cleanupPaths }) => ({
				items: [...items],
				_tag: "loaded" as const,
				failures: [...failures],
				cleanupPaths: [...cleanupPaths],
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

const recordNonMediaAdapterFailures = (
	payload: ImportRunJobData,
	failures: ReadonlyArray<NonMediaAdapterFailure>,
) => {
	const recordFailure = (failure: NonMediaAdapterFailure, index: number) => {
		const recordFailureEffect = recordImportRunFailure({
			runId: payload.runId,
			message: failure.message,
			itemIndex: failure.itemIndex,
			stage: "input_transformation",
			sourceLabel: failure.sourceLabel,
			sourceIdentifier: failure.sourceIdentifier,
		}).pipe(Effect.mapError(toWorkflowError));
		return Activity.make({
			error: ImportRunError,
			name: `record-adapter-failure-${index}`,
			execute: recordFailureEffect,
		});
	};
	return Effect.forEach(failures, recordFailure, { discard: true });
};

const recordNonMediaTotalItems = (payload: ImportRunJobData, totalItems: number) =>
	Effect.gen(function* () {
		const imports = yield* ImportsService;
		const updateTotalItems = imports
			.update({ runId: payload.runId, totalItems })
			.pipe(Effect.mapError(toWorkflowError));

		yield* Activity.make({
			error: ImportRunError,
			name: "record-total-items",
			execute: updateTotalItems,
		});
	});

const recordNonMediaItemFailure = (input: {
	index: number;
	item: NonMediaImportItem;
	payload: ImportRunJobData;
	outcome: Extract<NonMediaItemOutcome, { _tag: "failed" }>;
}) => {
	const recordItemFailure = recordImportRunFailure({
		runId: input.payload.runId,
		stage: input.outcome.stage,
		message: input.outcome.message,
		itemIndex: input.item.itemIndex,
		sourceLabel: input.item.sourceLabel,
		sourceIdentifier: input.item.sourceIdentifier,
		entitySchemaSlug: input.outcome.entitySchemaSlug ?? null,
	}).pipe(Effect.mapError(toWorkflowError));
	return Activity.make({
		error: ImportRunError,
		name: `record-item-failure-${input.index}`,
		execute: recordItemFailure,
	});
};

const reportNonMediaProgress = (input: {
	progress: number;
	failedItems: number;
	importedItems: number;
	processedItems: number;
	payload: ImportRunJobData;
}) =>
	Effect.gen(function* () {
		const imports = yield* ImportsService;
		const updateProgress = imports
			.update({
				progress: input.progress,
				runId: input.payload.runId,
				failedItems: input.failedItems,
				importedItems: input.importedItems,
				processedItems: input.processedItems,
			})
			.pipe(Effect.mapError(toWorkflowError));

		yield* Activity.make({
			error: ImportRunError,
			name: `report-progress-${input.processedItems}`,
			execute: updateProgress,
		});
	});

const writeNonMediaItems = <Item extends NonMediaImportItem, RWrite>(input: {
	items: ReadonlyArray<Item>;
	totalItems: number;
	payload: ImportRunJobData;
	adapterFailureCount: number;
	writeItem: NonMediaWriteItem<Item, RWrite>;
}) =>
	Effect.gen(function* () {
		let importedItems = 0;
		let failedItems = input.adapterFailureCount;
		let processedItems = input.adapterFailureCount;

		for (let i = 0; i < input.items.length; i += 1) {
			const item = input.items[i];
			if (!item) {
				continue;
			}

			const outcome = yield* input.writeItem({ item, index: i });
			if (outcome._tag === "failed") {
				failedItems += 1;
				yield* recordNonMediaItemFailure({ item, outcome, index: i, payload: input.payload });
			} else {
				importedItems += 1;
			}

			processedItems += 1;
			if (processedItems % PROGRESS_UPDATE_INTERVAL === 0 || processedItems === input.totalItems) {
				const progress =
					input.totalItems > 0 ? Math.round((processedItems / input.totalItems) * 100) : 100;
				yield* reportNonMediaProgress({
					progress,
					failedItems,
					importedItems,
					processedItems,
					payload: input.payload,
				});
			}
		}

		return { failedItems, importedItems, processedItems } satisfies NonMediaWriteSummary;
	});

const finalizeNonMediaImportRun = (payload: ImportRunJobData, summary: NonMediaWriteSummary) =>
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
					runId: payload.runId,
					failedItems: summary.failedItems,
					importedItems: summary.importedItems,
					processedItems: summary.processedItems,
				})
				.pipe(Effect.mapError(toWorkflowError)),
		});
	});

export const runOneTimeNonMediaImportWorkflow = (payload: ImportRunJobData) =>
	Effect.gen(function* () {
		const config = yield* AppConfig;
		const operationsService = yield* NonMediaImportWorkflowOperations;
		const initialCleanupPaths = payload.filePath
			? yield* resolveImportPath(payload.filePath, config.tmpDir)
			: [];
		let cleanupPaths: ReadonlyArray<string> = initialCleanupPaths;
		const { cleanupArtifactsBestEffort, failRunAndCleanup } = createImportRunLifecycle(payload);

		const processWorkflow = Effect.gen(function* () {
			const operationSet = yield* operationsService.getOperations(payload);
			yield* operationSet.withOperations((operations) =>
				Effect.gen(function* () {
					const markStarted = markImportRunStarted(payload.runId).pipe(
						Effect.mapError(toWorkflowError),
					);
					yield* Activity.make({
						error: ImportRunError,
						name: "mark-import-run-started",
						execute: markStarted,
					});

					const loadOutcome = yield* loadNonMediaAdapterResult(payload, operations);
					cleanupPaths = resolveCleanupPaths(loadOutcome, initialCleanupPaths);
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

					yield* recordNonMediaAdapterFailures(payload, loadOutcome.failures);
					yield* recordNonMediaTotalItems(payload, totalItems);

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

					const summary = yield* writeNonMediaItems({
						items,
						totalItems,
						payload,
						adapterFailureCount,
						writeItem: prepared.writeItem,
					});
					yield* finalizeNonMediaImportRun(payload, summary);
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
	});
