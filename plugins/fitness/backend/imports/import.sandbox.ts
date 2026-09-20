import {
	genericImportActivityReference,
	genericImportCaptureReference,
	genericImportSealReference,
	genericImportWorkflowInputSchema,
	genericImportWorkflowResultSchema,
} from "@ryot-app/sandbox-sdk/imports";
import {
	defineManifest,
	defineScriptReference,
	defineWorkflow,
	defineWorkflowReference,
	Effect,
	selectExecutable,
} from "@ryot-app/sandbox-sdk/workflow";

import { fitnessParsers } from "./references";
import {
	type FitnessStageInput,
	type FitnessStageResult,
	FitnessApplicationInput,
	FitnessApplicationOutput,
	FitnessMergeInput,
	FitnessMergeOutput,
	type FitnessSortedRun,
} from "./schemas";
import { FitnessSettingsInput, FitnessSettingsOutput } from "./settings";

export const manifest = defineManifest({
	kind: "workflow",
	capabilities: [],
	name: "Fitness import",
	slug: "workflow.import",
});

export class FitnessWorkflowError extends Error {
	readonly _tag = "FitnessWorkflowError";
}

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

export default defineWorkflow({
	manifest,
	input: genericImportWorkflowInputSchema,
	output: genericImportWorkflowResultSchema,
	run: (input, replay) =>
		Effect.gen(function* () {
			let expected: string | null = null;
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
					new FitnessWorkflowError("Fitness import plan does not match the admitted source"),
				);
			}
			const parser = selectExecutable(fitnessParsers, input.plan.selection["source-parser"]);
			const settings = yield* replay.activity("settings", settingsReference, {
				source: input.source,
				artifactHandle: input.sourcePayloadHandle,
			});
			let ordinal = 64;
			let advancedAt = input.command.occurredAt;
			const attribution = { runId: input.runId, command: input.command };
			const publish = (
				captureId: string,
				handle: string,
				phase: "collection" | "application",
				checkpoint: { stage: string; offset: number },
			) =>
				Effect.gen(function* () {
					return yield* replay.child(`capture:${captureId}`, genericImportCaptureReference, {
						...attribution,
						operation: {
							phase,
							handle,
							captureId,
							checkpoint,
							action: "capture",
							ordinal: ordinal++,
						},
					});
				});
			const activity = (
				id: string,
				kind: "reading" | "preparing" | "writing",
				completed: number,
				state: "running" | "completed",
				unit: string,
				advancement = `${completed}:${state}`,
			) =>
				Effect.gen(function* () {
					yield* replay.child(`activity:${id}:${advancement}`, genericImportActivityReference, {
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
					const result = yield* replay.activity(id, parser, stageInput);
					advancedAt = result.advancedAt;
					return result;
				});
			let offset = 0;
			let itemIndex = 0;
			let header = "";
			let runs: Array<FitnessSortedRun | undefined> = [];
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
							let leftPage = 0;
							let rightPage = 0;
							let leftOffset = 0;
							let rightOffset = 0;
							let pages = 0;
							const mergedPrefix = `${prefix}-${pass}-${pair}`;
							for (let segment = 0; ; segment++) {
								const result = yield* replay.child(
									`merge-segment:${mergedPrefix}:${segment}`,
									mergeReference,
									{
										...attribution,
										left,
										right,
										ordinal,
										leftPage,
										rightPage,
										leftOffset,
										rightOffset,
										page: pages,
										prefix: mergedPrefix,
										parser: parser.scriptSlug,
									},
								);
								pages = result.page;
								ordinal = result.ordinal;
								advancedAt = result.advancedAt;
								leftPage = result.leftPage;
								rightPage = result.rightPage;
								leftOffset = result.leftOffset;
								rightOffset = result.rightOffset;
								if (result.done) {
									break;
								}
							}
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
							return yield* Effect.fail(new FitnessWorkflowError("Fitness merge produced no run"));
						}
						incoming = merged;
						runs[level] = undefined;
					}
					return undefined;
				});
			const pendingRuns = () => runs.flatMap((run) => (run ? [run] : []));
			yield* activity("collection", "reading", 0, "running", "bytes");
			let sourceCarry: string | null = null;
			let sourceSize: number | null = null;
			for (let page = 0; ; page++) {
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
						new FitnessWorkflowError("Fitness collection did not return a capture"),
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
						return yield* Effect.fail(new FitnessWorkflowError("Fitness source carry is missing"));
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
					break;
				}
			}
			yield* activity("normalization", "preparing", 0, "running", "records");
			const sourceRun = yield* sort(pendingRuns(), "group-final");
			runs = [];
			let carry: string | null = null;
			let normalizedRows = 0;
			for (let page = 0; page < (sourceRun?.pages ?? 0); page++) {
				if (!sourceRun) {
					break;
				}
				const captureId = `${sourceRun.prefix}-${page}`;
				offset = 0;
				for (let part = 0; ; part++) {
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
							new FitnessWorkflowError("Fitness normalization did not return a capture"),
						);
					}
					yield* publish(id, handle, "collection", { stage: "normalized", offset: result.offset });
					carry = null;
					if (result.carryFile) {
						const carryHandle = result.chunkHandles[1];
						if (!carryHandle) {
							return yield* Effect.fail(
								new FitnessWorkflowError("Fitness normalization carry is missing"),
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
						break;
					}
				}
			}
			const writes = yield* sort(pendingRuns(), "order-final");
			yield* activity("normalization", "preparing", itemIndex, "completed", "records");
			const unit = input.source === "open_scale" ? "measurements" : "workouts";
			let batch = 0;
			let appliedRecords = 0;
			const issues: Array<(typeof genericImportWorkflowResultSchema.Type)["issues"][number]> = [];
			yield* activity("application", "writing", 0, "running", unit);
			if (writes) {
				let page = 0;
				offset = 0;
				for (let segment = 0; ; segment++) {
					const applied = yield* replay.child(
						`application-segment:${segment}`,
						applicationReference,
						{
							...attribution,
							unit,
							page,
							batch,
							offset,
							ordinal,
							run: writes,
							parser: parser.scriptSlug,
							completed: appliedRecords,
							issueLimit: 1000 - issues.length,
						},
					);
					issues.push(...applied.issues);
					page = applied.page;
					batch = applied.batch;
					offset = applied.offset;
					ordinal = applied.ordinal;
					appliedRecords = applied.completed;
					advancedAt = applied.advancedAt;
					if (applied.done) {
						break;
					}
				}
			}
			const sealed = yield* replay.child("seal", genericImportSealReference, {
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
