import {
	genericImportActivityReference,
	genericImportCaptureReference,
} from "@ryot-app/sandbox-sdk/imports";
import {
	defineManifest,
	defineWorkflow,
	defineWorkflowReference,
	Effect,
	selectExecutable,
} from "@ryot-app/sandbox-sdk/workflow";

import type { MediaSortedRun } from "../imports/collection-schemas";
import {
	MediaCollectionInput,
	MediaCollectionOutput,
	MediaMergeInput,
	MediaMergeOutput,
} from "../imports/process";
import { mediaSources } from "../imports/references";

export const manifest = defineManifest({
	kind: "workflow",
	capabilities: [],
	name: "Collect media source steps",
	slug: "workflow.media-import-collection",
});
const merger = defineWorkflowReference({
	input: MediaMergeInput,
	output: MediaMergeOutput,
	workflowSlug: "media-import-merge",
});
export default defineWorkflow({
	manifest,
	input: MediaCollectionInput,
	output: MediaCollectionOutput,
	run: (input, replay) =>
		Effect.gen(function* () {
			const source = selectExecutable(mediaSources, input.source);
			const attribution = { runId: input.runId, command: input.command };
			let { step, carry, offset, header, ordinal, itemIndex } = input;
			let done = false;
			let advancedAt = input.command.occurredAt;
			let eventOffset = input.eventOffset ?? 0;
			const runs: Array<MediaSortedRun | undefined> = [];
			const merge = (left: MediaSortedRun, right: MediaSortedRun, prefix: string) =>
				Effect.gen(function* () {
					let page = 0;
					let leftPage = 0;
					let rightPage = 0;
					let leftOffset = 0;
					let rightOffset = 0;
					for (let segment = 0; ; segment++) {
						const result: typeof MediaMergeOutput.Type = yield* replay.child(
							`merge:${prefix}:${segment}`,
							merger,
							{
								...attribution,
								left,
								page,
								right,
								prefix,
								ordinal,
								leftPage,
								rightPage,
								leftOffset,
								rightOffset,
							},
						);
						({ page, ordinal, leftPage, rightPage, leftOffset, rightOffset } = result);
						if (result.done) {
							return { prefix, pages: page };
						}
					}
				});
			for (let boundary = 0; boundary < 64; boundary++) {
				const captures: Record<string, string> = {};
				if (carry) {
					captures["carry"] = carry;
				}
				if (input.records) {
					captures["records"] = input.records;
				}
				const result = yield* replay.activity(`source:${step}`, source, {
					offset,
					header,
					itemIndex,
					eventOffset,
					action: input.action,
					settings: input.settings,
					fileIndex: input.fileIndex,
					importedAt: input.importedAt,
					...(input.entry ? { entry: input.entry } : {}),
					...(Object.keys(captures).length
						? { ingestionArtifacts: { captures, runId: input.runId } }
						: {}),
				});
				const prefix = `${input.prefix}-${step}`;
				const handle = result.chunkHandles[0];
				if (!handle) {
					throw new Error("Media source step did not return a capture");
				}
				yield* replay.child(`capture:${step}`, genericImportCaptureReference, {
					...attribution,
					operation: {
						handle,
						action: "capture",
						ordinal: ordinal++,
						phase: "collection",
						captureId: `${prefix}-0`,
						checkpoint: {
							stage: input.action,
							offset: result.offset,
							header: result.header,
							fileIndex: input.fileIndex,
							itemIndex: result.itemIndex,
							eventOffset: result.eventOffset,
						},
					},
				});
				carry = null;
				if (result.carryFile) {
					const carryHandle = result.chunkHandles[1];
					if (!carryHandle) {
						throw new Error("Media source step is missing its carry");
					}
					carry = `${prefix}-carry`;
					yield* replay.child(`carry:${step}`, genericImportCaptureReference, {
						...attribution,
						operation: {
							captureId: carry,
							action: "capture",
							ordinal: ordinal++,
							handle: carryHandle,
							phase: "collection",
							checkpoint: { stage: "source-carry", offset: result.offset },
						},
					});
				}
				let incoming: MediaSortedRun = { prefix, pages: 1 };
				for (let level = 0; ; level++) {
					const prior = runs[level];
					if (!prior) {
						runs[level] = incoming;
						break;
					}
					incoming = yield* merge(prior, incoming, `${prefix}-merge-${level}`);
					runs[level] = undefined;
				}
				offset = result.offset;
				itemIndex = result.itemIndex;
				header = result.header;
				done = result.done;
				step++;
				eventOffset = result.eventOffset;
				advancedAt = result.advancedAt;
				yield* replay.child(`progress:${step}`, genericImportActivityReference, {
					...attribution,
					operation: {
						action: "activity",
						activity: {
							wait: null,
							batchId: null,
							parentId: null,
							unit: "records",
							state: "running",
							exactTotal: null,
							completed: itemIndex,
							lastAdvancedAt: advancedAt,
							kind: input.action === "normalize" ? "preparing" : "reading",
							id: input.action === "normalize" ? "normalization" : "collection",
						},
					},
				});
				if (done) {
					break;
				}
			}
			let run: MediaSortedRun | null = null;
			for (const [level, candidate] of runs.entries()) {
				if (candidate) {
					run = run
						? yield* merge(run, candidate, `${input.prefix}-segment-${input.step}-${level}`)
						: candidate;
				}
			}
			return {
				run,
				step,
				done,
				carry,
				offset,
				header,
				ordinal,
				itemIndex,
				advancedAt,
				eventOffset,
			};
		}),
});
