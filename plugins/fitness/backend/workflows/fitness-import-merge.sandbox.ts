import { genericImportCaptureReference } from "@ryot-app/sandbox-sdk/imports";
import {
	defineManifest,
	defineWorkflow,
	Effect,
	selectExecutable,
} from "@ryot-app/sandbox-sdk/workflow";

import { fitnessParsers } from "../imports/references";
import { FitnessMergeInput, FitnessMergeOutput } from "../imports/schemas";

export const manifest = defineManifest({
	kind: "workflow",
	capabilities: [],
	slug: "workflow.import-merge",
	name: "Merge Fitness import captures",
});

export class FitnessMergeError extends Error {
	readonly _tag = "FitnessMergeError";
}

export default defineWorkflow({
	manifest,
	input: FitnessMergeInput,
	output: FitnessMergeOutput,
	run: (input, replay) =>
		Effect.gen(function* () {
			const parser = selectExecutable(fitnessParsers, input.parser);
			const attribution = { runId: input.runId, command: input.command };
			let page = input.page;
			let ordinal = input.ordinal;
			let leftPage = input.leftPage;
			let rightPage = input.rightPage;
			let leftOffset = input.leftOffset;
			let rightOffset = input.rightOffset;
			let advancedAt = input.command.occurredAt;
			let done = false;
			for (let iteration = 0; iteration < 32; iteration++) {
				const leftId = `${input.left.prefix}-${Math.min(leftPage, input.left.pages - 1)}`;
				const rightId = `${input.right.prefix}-${Math.min(rightPage, input.right.pages - 1)}`;
				const id = `${input.prefix}-${page}`;
				const result = yield* replay.activity(`merge:${id}`, parser, {
					leftOffset,
					rightOffset,
					action: "merge",
					leftFinal: leftPage >= input.left.pages - 1,
					rightFinal: rightPage >= input.right.pages - 1,
					ingestionArtifacts: { runId: input.runId, captures: { left: leftId, right: rightId } },
				});
				const handle = result.chunkHandles[0];
				if (!handle) {
					return yield* Effect.fail(
						new FitnessMergeError("Fitness merge did not return a capture"),
					);
				}
				yield* replay.child(`capture:${id}`, genericImportCaptureReference, {
					...attribution,
					operation: {
						handle,
						ordinal,
						captureId: id,
						action: "capture",
						phase: "collection",
						checkpoint: {
							page,
							leftPage,
							rightPage,
							stage: "merge",
							leftOffset: result.leftOffset,
							rightOffset: result.rightOffset,
						},
					},
				});
				ordinal++;
				page++;
				advancedAt = result.advancedAt;
				leftOffset = result.leftOffset;
				rightOffset = result.rightOffset;
				if (result.leftDone && leftPage < input.left.pages) {
					leftPage++;
					if (leftPage < input.left.pages) {
						leftOffset = 0;
					}
				}
				if (result.rightDone && rightPage < input.right.pages) {
					rightPage++;
					if (rightPage < input.right.pages) {
						rightOffset = 0;
					}
				}
				if (leftPage === input.left.pages && rightPage === input.right.pages) {
					done = true;
					break;
				}
			}
			return { page, done, ordinal, leftPage, rightPage, leftOffset, advancedAt, rightOffset };
		}),
});
