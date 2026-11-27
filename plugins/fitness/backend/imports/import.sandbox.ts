import {
	genericImportActivityReference,
	genericImportCaptureReference,
	genericImportSealReference,
	genericImportWorkflowInputSchema,
	genericImportWorkflowResultSchema,
} from "@ryot-app/plugin-backend-sdk/imports";
import {
	defineManifest,
	defineScriptReference,
	defineWorkflow,
	defineWorkflowReference,
	Effect,
	Schema,
	selectExecutable,
} from "@ryot-app/plugin-backend-sdk/workflow";

import { fitnessParsers } from "./references";
import {
	FitnessApplicationInput,
	FitnessApplicationOutput,
	FitnessMergeInput,
	FitnessMergeOutput,
	FitnessSortedRun,
	type FitnessStageInput,
	type FitnessStageResult,
} from "./schemas";
import { FitnessSettingsInput, FitnessSettingsOutput } from "./settings";

export const manifest = defineManifest({
	kind: "workflow",
	name: "Fitness import",
	slug: "workflow.import",
});

export class FitnessWorkflowError extends Schema.TaggedError<
	FitnessWorkflowError,
	{ readonly brand: unique symbol }
>()("FitnessWorkflowError", { message: Schema.String }) {}

const applicationReference = defineWorkflowReference({
	input: FitnessApplicationInput,
	output: FitnessApplicationOutput,
	workflowSlug: "import-application",
});
const mergeReference = defineWorkflowReference({
	input: FitnessMergeInput,
	output: FitnessMergeOutput,
	workflowSlug: "import-merge",
});
const settingsReference = defineScriptReference({
	input: FitnessSettingsInput,
	scriptSlug: "import.settings",
	output: FitnessSettingsOutput,
});

const checkpointSchema = Schema.Struct({
	page: Schema.Int,
	offset: Schema.Int,
	ordinal: Schema.Int,
	itemIndex: Schema.Int,
	header: Schema.String,
	advancedAt: Schema.String,
	normalizePage: Schema.Int,
	normalizePart: Schema.Int,
	normalizedRows: Schema.Int,
	settings: FitnessSettingsOutput,
	carry: Schema.NullOr(Schema.String),
	sourceSize: Schema.NullOr(Schema.Finite),
	sourceCarry: Schema.NullOr(Schema.String),
	sourceRun: Schema.NullOr(FitnessSortedRun),
	runs: Schema.Array(Schema.NullOr(FitnessSortedRun)),
	phase: Schema.Literals(["collection", "normalization", "application"]),
});
export default defineWorkflow({
	manifest,
	checkpoint: checkpointSchema,
	input: genericImportWorkflowInputSchema,
	output: genericImportWorkflowResultSchema,
	run: (input, step, checkpoint) =>
		Effect.gen(function* () {
			let expected: null | string = null;
			if (input.source === "hevy") {
				expected = "import.hevy";
			}
			if (input.source === "strong_app") {
				expected = "import.strong-app";
			}
			if (input.source === "open_scale") {
				expected = "import.open-scale";
			}
			if (
				!expected ||
				input.plan.operation !== "import" ||
				input.plan.selection["source-parser"] !== expected
			) {
				return yield* Effect.fail(
					new FitnessWorkflowError({
						message: "Fitness import plan does not match the admitted source",
					}),
				);
			}
			const parser = selectExecutable(fitnessParsers, input.plan.selection["source-parser"]);
			const settings =
				checkpoint?.settings ??
				(yield* step.activity("settings", settingsReference, {
					artifactHandle: input.sourcePayloadHandle,
				}));
			let ordinal = checkpoint?.ordinal ?? 64;
			let advancedAt = checkpoint?.advancedAt ?? input.command.occurredAt;
			const attribution = { runId: input.runId, command: input.command };
			const publish = (
				captureId: string,
				handle: string,
				phase: "collection" | "application",
				captureCheckpoint: { stage: string; offset: number },
			) =>
				Effect.gen(function* () {
					return yield* step.child(`capture:${captureId}`, genericImportCaptureReference, {
						...attribution,
						operation: {
							phase,
							handle,
							captureId,
							action: "capture",
							ordinal: ordinal++,
							checkpoint: captureCheckpoint,
						},
					});
				});
			const activity = (
				id: string,
				kind: "reading" | "writing" | "preparing",
				completed: number,
				state: "running" | "completed",
				unit: string,
				advancement = `${completed}:${state}`,
			) =>
				Effect.gen(function* () {
					yield* step.child(`activity:${id}:${advancement}`, genericImportActivityReference, {
						...attribution,
						operation: {
							action: "activity",
							activity: {
								id,
								kind,
								unit,
								state,
								completed,
								wait: null,
								batchId: null,
								parentId: null,
								exactTotal: null,
								lastAdvancedAt: advancedAt,
							},
						},
					});
				});
			const stage = (id: string, stageInput: typeof FitnessStageInput.Type) =>
				Effect.gen(function* () {
					const result = yield* step.activity(id, parser, stageInput);
					advancedAt = result.advancedAt;
					return result;
				});
			let offset = checkpoint?.offset ?? 0;
			let itemIndex = checkpoint?.itemIndex ?? 0;
			let header = checkpoint?.header ?? "";
			let runs: Array<null | FitnessSortedRun> = [...(checkpoint?.runs ?? [])];
			const sort = (initial: FitnessSortedRun[], prefix: string) =>
				Effect.gen(function* () {
					let current = initial;
					for (let pass = 0; current.length > 1; pass++) {
						const next: FitnessSortedRun[] = [];
						for (let pair = 0; pair < current.length; pair += 2) {
							const left = current[pair];
							const right = current[pair + 1];
							if (!left) {
								continue;
							}
							if (!right) {
								next.push(left);
								continue;
							}
							const mergedPrefix = `${prefix}-${pass}-${pair}`;
							const result = yield* step.child(`merge:${mergedPrefix}`, mergeReference, {
								...attribution,
								left,
								right,
								ordinal,
								page: 0,
								leftPage: 0,
								rightPage: 0,
								leftOffset: 0,
								rightOffset: 0,
								prefix: mergedPrefix,
								parser: parser.scriptSlug,
							});
							const pages = result.page;
							ordinal = result.ordinal;
							advancedAt = result.advancedAt;
							next.push({ pages, prefix: mergedPrefix });
						}
						current = next;
					}
					return current[0] ?? null;
				});
			const addRun = (run: FitnessSortedRun, prefix: string) =>
				Effect.gen(function* () {
					let incoming = run;
					for (let level = 0; ; level++) {
						const prior = runs[level];
						if (!prior) {
							runs[level] = incoming;
							break;
						}
						const merged = yield* sort([prior, incoming], `${prefix}-${level}`);
						if (!merged) {
							return yield* Effect.fail(
								new FitnessWorkflowError({ message: "Fitness merge produced no run" }),
							);
						}
						incoming = merged;
						runs[level] = null;
					}
					return undefined;
				});
			const pendingRuns = () => runs.flatMap((run) => (run ? [run] : []));
			let sourceCarry = checkpoint?.sourceCarry ?? null;
			let sourceSize = checkpoint?.sourceSize ?? null;
			let sourceRun = checkpoint?.sourceRun ?? null;
			let carry = checkpoint?.carry ?? null;
			let normalizedRows = checkpoint?.normalizedRows ?? 0;
			const save = (
				phase: (typeof checkpointSchema.Type)["phase"],
				page: number,
				normalizePage: number,
				normalizePart: number,
			) =>
				step.save({
					page,
					runs,
					phase,
					carry,
					offset,
					header,
					ordinal,
					settings,
					itemIndex,
					sourceRun,
					advancedAt,
					sourceSize,
					sourceCarry,
					normalizePage,
					normalizePart,
					normalizedRows,
				});
			if (!checkpoint || checkpoint.phase === "collection") {
				if (!checkpoint) {
					yield* activity("collection", "reading", 0, "running", "bytes");
				}
				const page = checkpoint?.page ?? 0;
				const collected: typeof FitnessStageResult.Type = yield* stage(`collect:${page}`, {
					offset,
					header,
					itemIndex,
					size: sourceSize,
					action: "collect",
					carry: sourceCarry,
					...(sourceCarry
						? { ingestionArtifacts: { runId: input.runId, captures: { sourceCarry } } }
						: {}),
				});
				const handle = collected.chunkHandles[0];
				if (!handle) {
					return yield* Effect.fail(
						new FitnessWorkflowError({ message: "Fitness collection did not return a capture" }),
					);
				}
				const prefix = `source-${page}`;
				yield* publish(`${prefix}-0`, handle, "collection", {
					stage: "collection",
					offset: collected.offset,
				});
				sourceCarry = null;
				if (collected.carryFile) {
					const carryHandle = collected.chunkHandles[1];
					if (!carryHandle) {
						return yield* Effect.fail(
							new FitnessWorkflowError({ message: "Fitness source carry is missing" }),
						);
					}
					sourceCarry = `${prefix}-carry`;
					yield* publish(sourceCarry, carryHandle, "collection", {
						stage: "source-carry",
						offset: collected.offset,
					});
				}
				offset = collected.offset;
				itemIndex = collected.itemIndex;
				header = collected.header;
				sourceSize = collected.totalSize;
				yield* activity(
					"collection",
					"reading",
					offset,
					collected.done ? "completed" : "running",
					"bytes",
					`page-${page}`,
				);
				yield* addRun({ prefix, pages: 1 }, `group-${page}`);
				if (collected.done) {
					sourceRun = yield* sort(pendingRuns(), "group-final");
					runs = [];
					offset = 0;
					yield* activity("normalization", "preparing", 0, "running", "records");
					return yield* save("normalization", page + 1, 0, 0);
				}
				return yield* save("collection", page + 1, 0, 0);
			}
			if (checkpoint.phase === "normalization") {
				const page = checkpoint.normalizePage;
				if (sourceRun && page < sourceRun.pages) {
					const captureId = `${sourceRun.prefix}-${page}`;
					const part = checkpoint.normalizePart;
					const prefix = `normalized-${page}-${part}`;
					const id = `${prefix}-0`;
					const captures: Record<string, string> = { records: captureId };
					if (carry) {
						captures["carry"] = carry;
					}
					const result = yield* stage(`normalize:${id}`, {
						carry,
						offset,
						action: "normalize",
						timezone: settings.timezone,
						final: page === sourceRun.pages - 1,
						ingestionArtifacts: { captures, runId: input.runId },
					});
					const handle = result.chunkHandles[0];
					if (!handle) {
						return yield* Effect.fail(
							new FitnessWorkflowError({
								message: "Fitness normalization did not return a capture",
							}),
						);
					}
					yield* publish(id, handle, "collection", { stage: "normalized", offset: result.offset });
					carry = null;
					if (result.carryFile) {
						const carryHandle = result.chunkHandles[1];
						if (!carryHandle) {
							return yield* Effect.fail(
								new FitnessWorkflowError({ message: "Fitness normalization carry is missing" }),
							);
						}
						carry = `${id}-carry`;
						yield* publish(carry, carryHandle, "collection", {
							stage: "carry",
							offset: result.offset,
						});
					}
					yield* addRun({ prefix, pages: 1 }, `order-${page}-${part}`);
					offset = result.offset;
					normalizedRows += result.itemIndex;
					yield* activity(
						"normalization",
						"preparing",
						normalizedRows,
						"running",
						"records",
						`${page}-${part}`,
					);
					if (result.done) {
						offset = 0;
						return yield* save("normalization", checkpoint.page, page + 1, 0);
					}
					return yield* save("normalization", checkpoint.page, page, part + 1);
				}
				return yield* save("application", checkpoint.page, checkpoint.normalizePage, 0);
			}
			const writes = yield* sort(pendingRuns(), "order-final");
			yield* activity("normalization", "preparing", itemIndex, "completed", "records");
			const unit = input.source === "open_scale" ? "measurements" : "workouts";
			yield* activity("application", "writing", 0, "running", unit);
			const applied = writes
				? yield* step.child("application", applicationReference, {
						...attribution,
						unit,
						page: 0,
						ordinal,
						batch: 0,
						offset: 0,
						run: writes,
						completed: 0,
						issueLimit: 1000,
						parser: parser.scriptSlug,
					})
				: null;
			const issues = applied?.issues ?? [];
			if (applied) {
				advancedAt = applied.advancedAt;
			}
			const sealed = yield* step.child("seal", genericImportSealReference, {
				...attribution,
				operation: { action: "seal" },
			});
			const completed = sealed.summary
				.filter((dimension) => dimension.unit === unit)
				.reduce(
					(sum, dimension) =>
						sum + Object.values(dimension.counts).reduce((count, value) => count + value, 0),
					0,
				);
			yield* activity("application", "writing", completed, "completed", unit);
			return { issues, summary: sealed.summary };
		}),
});
