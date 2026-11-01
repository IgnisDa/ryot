import {
	genericImportActivityReference,
	genericImportCaptureReference,
} from "@ryot-app/plugin-backend-sdk/imports";
import {
	defineManifest,
	defineWorkflow,
	Effect,
	selectExecutable,
} from "@ryot-app/plugin-backend-sdk/workflow";

import { MediaCollectionInput, MediaCollectionOutput } from "../imports/process";
import { mediaSources } from "../imports/references";
import { mediaSortedRuns } from "../imports/sorted-runs";

export const manifest = defineManifest({
	kind: "workflow",
	name: "Collect media source steps",
	slug: "workflow.media-import-collection",
});
export default defineWorkflow({
	manifest,
	input: MediaCollectionInput,
	output: MediaCollectionOutput,
	run: (input, replay) =>
		Effect.gen(function* () {
			const source = selectExecutable(mediaSources, input.source);
			const attribution = { runId: input.runId, command: input.command };
			let { step, carry, offset, header, itemIndex } = input;
			const state = { ordinal: input.ordinal };
			let done = false;
			let advancedAt = input.command.occurredAt;
			let eventOffset = input.eventOffset ?? 0;
			const runs = mediaSortedRuns(replay, attribution, state);
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
						phase: "collection",
						ordinal: state.ordinal++,
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
							handle: carryHandle,
							phase: "collection",
							ordinal: state.ordinal++,
							checkpoint: { stage: "source-carry", offset: result.offset },
						},
					});
				}
				yield* runs.add({ prefix, pages: 1 }, `${prefix}-merge`);
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
			const run = yield* runs.finish(`${input.prefix}-segment-${input.step}`);
			return {
				run,
				step,
				done,
				carry,
				offset,
				header,
				itemIndex,
				advancedAt,
				eventOffset,
				ordinal: state.ordinal,
			};
		}),
});
