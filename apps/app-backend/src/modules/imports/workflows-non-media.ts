import { Activity } from "@effect/workflow";
import { Cause, DateTime, Effect, Schema } from "effect";

import { DbRunner } from "#lib/db";
import { unknownToMessage } from "#lib/errors";

import type { ImportRunJobData } from "./jobs";
import { ImportsRepository } from "./repository";
import { PROGRESS_UPDATE_INTERVAL, recordImportRunFailure } from "./runtime/failures";
import {
	getTemporaryDirectory,
	readImportFile,
	resolveImportPath,
	resolveSafeImportFilePath,
} from "./runtime/files";
import { getKnownImportExtensions } from "./runtime/source-definitions";
import {
	createImportRunLifecycle,
	ImportRunError,
	toWorkflowError,
} from "./runtime/workflow-helpers";
import type { ImportRunFailureStage } from "./types";

export const NonMediaAdapterFailureSchema = Schema.Struct({
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

export type NonMediaImportOperations<
	Item extends NonMediaImportItem,
	RLoad,
	RPrepare,
	RWrite,
	RCleanup,
> = {
	itemSchema: Schema.Schema<Item>;
	cleanupArtifacts: (input: {
		sourcePayloadKey?: string;
		cleanupPaths: ReadonlyArray<string>;
	}) => Effect.Effect<void, unknown, RCleanup>;
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

export const loadNonMediaImportText = Effect.fn("importsNonMedia.loadNonMediaImportText")(
	function* (payload: ImportRunJobData) {
		if (!payload.filePath) {
			return yield* Effect.fail({
				cleanupPaths: [] as ReadonlyArray<string>,
				message: "Import job is missing file path",
			} satisfies NonMediaLoadError);
		}

		const safePathResult = resolveSafeImportFilePath(payload.filePath, getTemporaryDirectory());
		if ("error" in safePathResult) {
			return yield* Effect.fail({
				cleanupPaths: [] as ReadonlyArray<string>,
				message: "Import job has an invalid file path",
			} satisfies NonMediaLoadError);
		}

		const safePath = safePathResult.path;
		const extResult = validateImportExtension(safePath);
		if ("error" in extResult) {
			return yield* Effect.fail({
				cleanupPaths: [safePath],
				message: "Import job has an invalid file extension",
			} satisfies NonMediaLoadError);
		}

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

const validateImportExtension = (filePath: string): { ok: true } | { error: string } => {
	const segment = filePath.split(/[\\/]/).pop() ?? "";
	const dotIndex = segment.lastIndexOf(".");
	const ext = dotIndex > 0 ? segment.slice(dotIndex + 1).toLowerCase() : "";
	return getKnownImportExtensions().includes(ext) ? { ok: true } : { error: "invalid extension" };
};

const makeLoadOutcomeSchema = <Item>(itemSchema: Schema.Schema<Item>) =>
	Schema.Union(
		Schema.TaggedStruct("failed", {
			message: Schema.String,
			cleanupPaths: Schema.Array(Schema.String),
			fallbackToInitialCleanupPaths: Schema.Boolean,
		}),
		Schema.TaggedStruct("loaded", {
			items: Schema.Array(itemSchema),
			cleanupPaths: Schema.Array(Schema.String),
			failures: Schema.Array(NonMediaAdapterFailureSchema),
		}),
	);

export const runOneTimeNonMediaImportWorkflow = <
	Item extends NonMediaImportItem,
	RLoad,
	RPrepare,
	RWrite,
	RCleanup,
>(
	payload: ImportRunJobData,
	operations: NonMediaImportOperations<Item, RLoad, RPrepare, RWrite, RCleanup>,
) =>
	Effect.gen(function* () {
		const runWithDb = yield* DbRunner;
		const repository = yield* ImportsRepository;

		const initialCleanupPaths = payload.filePath ? resolveImportPath(payload.filePath) : [];
		let cleanupPaths: ReadonlyArray<string> = initialCleanupPaths;
		const { cleanupArtifactsBestEffort, failRunAndCleanup } = createImportRunLifecycle(
			payload,
			operations.cleanupArtifacts,
		);
		const mergeCleanupPaths = (paths: ReadonlyArray<string>) => [
			...new Set([...initialCleanupPaths, ...paths]),
		];

		const processWorkflow = Effect.gen(function* () {
			const startedAt = yield* DateTime.nowAsDate;
			yield* Activity.make({
				error: ImportRunError,
				name: "mark-import-run-started",
				execute: runWithDb(
					repository.updateRun({ runId: payload.runId, status: "running", startedAt }),
				).pipe(Effect.mapError(toWorkflowError)),
			});

			const loadOutcome = yield* Activity.make({
				name: "load-non-media-import-adapter-result",
				success: makeLoadOutcomeSchema(operations.itemSchema),
				execute: operations.loadAdapterResult(payload).pipe(
					Effect.map(({ items, failures, cleanupPaths: loadedCleanupPaths }) => ({
						_tag: "loaded" as const,
						items: [...items],
						failures: [...failures],
						cleanupPaths: [...loadedCleanupPaths],
					})),
					Effect.catchAll((error) =>
						Effect.succeed({
							_tag: "failed" as const,
							fallbackToInitialCleanupPaths: false,
							message: error.message,
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

			cleanupPaths =
				loadOutcome._tag === "failed"
					? loadOutcome.fallbackToInitialCleanupPaths
						? mergeCleanupPaths(loadOutcome.cleanupPaths)
						: [...loadOutcome.cleanupPaths]
					: mergeCleanupPaths(loadOutcome.cleanupPaths);
			if (loadOutcome._tag === "failed") {
				yield* failRunAndCleanup({
					message: loadOutcome.message,
					cleanupPaths,
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
							stage: "input_transformation",
							message: failure.message,
							itemIndex: failure.itemIndex,
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
					message: prepared.message,
					cleanupPaths,
					failureName: "fail-import-run-on-prepare-error",
					cleanupName: "cleanup-import-artifacts-on-prepare-failure",
				});
				return;
			}

			let failedItems = adapterFailureCount;
			let importedItems = 0;
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
					const progress = totalItems > 0 ? Math.round((processedItems / totalItems) * 100) : 100;
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
