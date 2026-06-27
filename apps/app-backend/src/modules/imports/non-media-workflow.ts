import { Activity } from "@effect/workflow";
import { unknownToMessage } from "@ryot/contract/errors";
import { Cause, Effect, Schema } from "effect";

import { AppConfig } from "#lib/infrastructure/config/service";
import { DbRunner } from "#lib/infrastructure/db/service";
import { RedisService, redisKeys } from "#lib/infrastructure/redis";

import type { ImportRunJobData } from "./jobs";
import {
	NonMediaAdapterFailureSchema,
	NonMediaImportWorkflowOperations,
	type NonMediaAdapterFailure,
	type NonMediaImportItem,
	type NonMediaImportOperations,
	type NonMediaItemOutcome,
	type NonMediaLoadError,
	type NonMediaWriteItem,
} from "./non-media-types";
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
	finalizeImportRun,
	ImportRunError,
	recordImportTotalItems,
	toWorkflowError,
} from "./runtime/workflow-helpers";

const NonMediaLoadOutcome = Schema.Union(
	Schema.TaggedStruct("failed", {
		message: Schema.String,
		fallbackToInitialCleanupPaths: Schema.Boolean,
		cleanupPaths: Schema.Array(Schema.String),
	}),
	Schema.TaggedStruct("loaded", {
		itemCount: Schema.Number,
		chunkCount: Schema.Number,
		cleanupPaths: Schema.Array(Schema.String),
		failures: Schema.Array(NonMediaAdapterFailureSchema),
	}),
);

type NonMediaLoadOutcome = typeof NonMediaLoadOutcome.Type;

type NonMediaWriteSummary = {
	failedItems: number;
	importedItems: number;
	processedItems: number;
};

const nonMediaChunkSize = 100;

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

const mergeCleanupPaths = (
	initialCleanupPaths: ReadonlyArray<string>,
	loadedCleanupPaths: ReadonlyArray<string>,
) => [...new Set([...initialCleanupPaths, ...loadedCleanupPaths])];

const resolveCleanupPaths = (
	loadOutcome: NonMediaLoadOutcome,
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
		success: NonMediaLoadOutcome,
		name: "load-non-media-import-adapter-result",
		execute: operations.loadAdapterResult(payload).pipe(
			Effect.flatMap(({ items, failures, cleanupPaths }) =>
				Effect.gen(function* () {
					const redis = yield* RedisService;
					const chunks = Array.from(
						{ length: Math.ceil(items.length / nonMediaChunkSize) },
						(_, index) => items.slice(index * nonMediaChunkSize, (index + 1) * nonMediaChunkSize),
					);
					const ChunkFromJson = Schema.parseJson(Schema.Array(operations.itemSchema));
					yield* Effect.forEach(
						chunks,
						(chunk, index) =>
							Schema.encode(ChunkFromJson)(chunk).pipe(
								Effect.orDie,
								Effect.flatMap((encoded) =>
									redis.set(
										redisKeys.importNonMediaChunk(payload.runId, index),
										encoded,
										24 * 60 * 60,
									),
								),
							),
						{ concurrency: 4, discard: true },
					);
					return {
						_tag: "loaded" as const,
						failures: [...failures],
						itemCount: items.length,
						chunkCount: chunks.length,
						cleanupPaths: [...cleanupPaths],
					};
				}),
			),
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

const loadNonMediaChunk = <Item>(
	payload: ImportRunJobData,
	itemSchema: Schema.Schema<Item>,
	chunkIndex: number,
) =>
	Activity.make({
		error: ImportRunError,
		success: Schema.Array(itemSchema),
		name: `load-non-media-chunk-${chunkIndex}`,
		execute: Effect.gen(function* () {
			const redis = yield* RedisService;
			const raw = yield* redis.get(redisKeys.importNonMediaChunk(payload.runId, chunkIndex));
			if (raw === null) {
				return yield* new ImportRunError({
					message: `Non-media import chunk ${chunkIndex} is missing`,
				});
			}
			return yield* Schema.decode(Schema.parseJson(Schema.Array(itemSchema)))(raw).pipe(
				Effect.mapError((error) => new ImportRunError({ message: error.message })),
			);
		}),
	});

const recordNonMediaAdapterFailures = (
	payload: ImportRunJobData,
	failures: ReadonlyArray<NonMediaAdapterFailure>,
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
					stage: "input_transformation",
					sourceLabel: failure.sourceLabel,
					sourceIdentifier: failure.sourceIdentifier,
				}).pipe(Effect.mapError(toWorkflowError)),
			}),
		{ discard: true },
	);

const recordNonMediaItemFailure = (input: {
	index: number;
	item: NonMediaImportItem;
	payload: ImportRunJobData;
	outcome: Extract<NonMediaItemOutcome, { _tag: "failed" }>;
}) =>
	Activity.make({
		error: ImportRunError,
		name: `record-item-failure-${input.index}`,
		execute: recordImportRunFailure({
			runId: input.payload.runId,
			stage: input.outcome.stage,
			message: input.outcome.message,
			itemIndex: input.item.itemIndex,
			sourceLabel: input.item.sourceLabel,
			sourceIdentifier: input.item.sourceIdentifier,
			entitySchemaSlug: input.outcome.entitySchemaSlug ?? null,
		}).pipe(Effect.mapError(toWorkflowError)),
	});

const reportNonMediaProgress = (input: {
	progress: number;
	failedItems: number;
	importedItems: number;
	processedItems: number;
	payload: ImportRunJobData;
}) =>
	Effect.gen(function* () {
		const runWithDb = yield* DbRunner;
		const repository = yield* ImportsRepository;

		yield* Activity.make({
			error: ImportRunError,
			name: `report-progress-${input.processedItems}`,
			execute: runWithDb(
				repository.updateRun({
					progress: input.progress,
					runId: input.payload.runId,
					failedItems: input.failedItems,
					importedItems: input.importedItems,
					processedItems: input.processedItems,
				}),
			).pipe(Effect.mapError(toWorkflowError)),
		});
	});

const writeNonMediaItems = <Item extends NonMediaImportItem, RWrite>(input: {
	totalItems: number;
	payload: ImportRunJobData;
	items: ReadonlyArray<Item>;
	initialSummary: NonMediaWriteSummary;
	writeItem: NonMediaWriteItem<Item, RWrite>;
}) =>
	Effect.gen(function* () {
		let failedItems = input.initialSummary.failedItems;
		let importedItems = input.initialSummary.importedItems;
		let processedItems = input.initialSummary.processedItems;

		for (let i = 0; i < input.items.length; i += 1) {
			const item = input.items[i];
			if (!item) {
				continue;
			}

			const itemIndex = item.itemIndex;
			const outcome = yield* input.writeItem({ item, index: itemIndex });
			if (outcome._tag === "failed") {
				failedItems += 1;
				yield* recordNonMediaItemFailure({
					item,
					outcome,
					index: itemIndex,
					payload: input.payload,
				});
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

export const runOneTimeNonMediaImportWorkflow = Effect.fn("runOneTimeNonMediaImportWorkflow")(
	function* (payload: ImportRunJobData) {
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
					yield* Activity.make({
						error: ImportRunError,
						name: "mark-import-run-started",
						execute: markImportRunStarted(payload.runId).pipe(Effect.mapError(toWorkflowError)),
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

					const adapterFailureCount = loadOutcome.failures.length;
					const totalItems = loadOutcome.itemCount + adapterFailureCount;

					yield* recordNonMediaAdapterFailures(payload, loadOutcome.failures);
					yield* recordImportTotalItems(payload, totalItems);

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

					let summary: NonMediaWriteSummary = {
						importedItems: 0,
						failedItems: adapterFailureCount,
						processedItems: adapterFailureCount,
					};
					for (let chunkIndex = 0; chunkIndex < loadOutcome.chunkCount; chunkIndex += 1) {
						const items = yield* loadNonMediaChunk(payload, operations.itemSchema, chunkIndex);
						summary = yield* writeNonMediaItems({
							items,
							payload,
							totalItems,
							initialSummary: summary,
							writeItem: prepared.writeItem,
						});
					}
					yield* finalizeImportRun({
						payload,
						failedItems: summary.failedItems,
						importedItems: summary.importedItems,
						processedItems: summary.processedItems,
					});
					yield* Activity.make({
						name: "cleanup-non-media-chunks",
						execute: Effect.gen(function* () {
							const redis = yield* RedisService;
							yield* redis.del(
								...Array.from({ length: loadOutcome.chunkCount }, (_, index) =>
									redisKeys.importNonMediaChunk(payload.runId, index),
								),
							);
						}),
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
