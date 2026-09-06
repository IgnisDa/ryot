import { defineManifest, defineWorkflow, Effect } from "@ryot-app/sandbox-sdk/workflow";

import {
	BATCH_SIZE,
	MediaImportSegmentInput,
	MediaImportSegmentOutput,
	mediaImportParser,
	runMediaImportBatch,
} from "../imports/batch";

export const manifest = defineManifest({
	kind: "workflow",
	capabilities: [],
	name: "Media import segment",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	slug: "workflow.media-import-segment",
});

const SEGMENT_BATCHES = 100;

export default defineWorkflow({
	manifest,
	input: MediaImportSegmentInput,
	output: MediaImportSegmentOutput,
	run: (input, replay) =>
		Effect.gen(function* () {
			let totalItems = 0;
			let failureCount = 0;
			let writeItemCount = 0;
			let start = input.start;
			const chunkHandles: string[] = [];

			for (let batchCount = 0; batchCount < SEGMENT_BATCHES; batchCount += 1) {
				const batchIndex = start / BATCH_SIZE;
				const batch = yield* replay.activity(
					`parse-${batchIndex}`,
					mediaImportParser(input.source),
					{ ...input.parserInput, start },
				);
				const chunk = yield* runMediaImportBatch(replay, {
					batch,
					batchIndex,
					runId: input.runId,
					command: input.command,
				});
				chunkHandles.push(...chunk.chunkHandles);
				totalItems += chunk.totalItems;
				failureCount += chunk.failureCount;
				writeItemCount += chunk.writeItemCount;
				start += BATCH_SIZE;
				if (batch.totalItems === 0 || start >= batch.totalItems) {
					return { totalItems, failureCount, chunkHandles, writeItemCount, nextStart: null };
				}
			}

			return { totalItems, failureCount, chunkHandles, writeItemCount, nextStart: start };
		}),
});
