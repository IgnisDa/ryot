import { genericImportCaptureReference } from "@ryot-app/plugin-backend-sdk/imports";
import { defineManifest, defineWorkflow, Effect } from "@ryot-app/plugin-backend-sdk/workflow";

import { MediaMergeInput, MediaMergeOutput } from "../imports/process";
import { mediaMerge } from "../imports/references";

export const manifest = defineManifest({
	kind: "workflow",
	slug: "workflow.media-import-merge",
	name: "Merge media source captures",
});
export default defineWorkflow({
	manifest,
	input: MediaMergeInput,
	output: MediaMergeOutput,
	checkpoint: MediaMergeOutput,
	run: (initial, step, checkpoint) =>
		Effect.gen(function* () {
			const input = { ...initial, ...checkpoint };
			let { page, ordinal, leftPage, rightPage, leftOffset, rightOffset } = input;
			const attribution = { runId: input.runId, command: input.command };
			for (let iteration = 0; iteration < 16; iteration++) {
				const result = yield* step.activity(`merge:${page}`, mediaMerge, {
					offset: 0,
					header: "",
					leftOffset,
					rightOffset,
					fileIndex: 0,
					itemIndex: 0,
					settings: {},
					action: "merge",
					importedAt: input.command.occurredAt,
					leftFinal: leftPage === input.left.pages - 1,
					rightFinal: rightPage === input.right.pages - 1,
					ingestionArtifacts: {
						runId: input.runId,
						captures: {
							left: `${input.left.prefix}-${leftPage}`,
							right: `${input.right.prefix}-${rightPage}`,
						},
					},
				});
				const handle = result.chunkHandles[0];
				if (!handle) {
					throw new Error("Media merge did not return a capture");
				}
				const captureId = `${input.prefix}-${page}`;
				yield* step.child(`capture:${page}`, genericImportCaptureReference, {
					...attribution,
					operation: {
						handle,
						captureId,
						action: "capture",
						ordinal: ordinal++,
						phase: "collection",
						checkpoint: {
							leftPage,
							rightPage,
							stage: "merge",
							leftOffset: result.leftOffset,
							rightOffset: result.rightOffset,
						},
					},
				});
				page++;
				leftOffset = result.leftOffset;
				rightOffset = result.rightOffset;
				const done =
					result.leftDone &&
					result.rightDone &&
					leftPage === input.left.pages - 1 &&
					rightPage === input.right.pages - 1;
				if (result.leftDone && leftPage < input.left.pages - 1) {
					leftPage++;
					leftOffset = 0;
				}
				if (result.rightDone && rightPage < input.right.pages - 1) {
					rightPage++;
					rightOffset = 0;
				}
				if (done) {
					return { page, ordinal, leftPage, rightPage, leftOffset, done: true, rightOffset };
				}
			}
			return yield* step.save({
				page,
				ordinal,
				leftPage,
				rightPage,
				leftOffset,
				rightOffset,
				done: false,
			});
		}),
});
