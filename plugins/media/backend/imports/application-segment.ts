import {
	genericImportApplyReference,
	genericImportCaptureReference,
} from "@ryot-app/sandbox-sdk/imports";
import {
	type Effect,
	defineScriptReference,
	type WorkflowReplay,
} from "@ryot-app/sandbox-sdk/workflow";

import type { MediaIntegrationConfirmation } from "../integrations/schemas";
import { type MediaWorkflowError, runMediaImportBatch } from "./batch";
import type { MediaApplicationInput, MediaApplicationOutput } from "./process";
import { MediaReadBatchInput, MediaReadBatchResult } from "./process";
import { appendMediaIssues } from "./reports";

const reader = defineScriptReference({
	input: MediaReadBatchInput,
	output: MediaReadBatchResult,
	scriptSlug: "import.read-batch",
});
export function* applyMediaSegment(
	input: typeof MediaApplicationInput.Type,
	replay: WorkflowReplay,
	confirm?: (
		confirmation: typeof MediaIntegrationConfirmation.Type,
		batch: number,
	) => Generator<ReturnType<WorkflowReplay["activity"]>, unknown, unknown>,
): Generator<
	ReturnType<WorkflowReplay["child"]> | ReturnType<typeof Effect.fail<MediaWorkflowError>>,
	typeof MediaApplicationOutput.Type,
	unknown
> {
	let { page, batch, offset, ordinal, dedupKey, itemIndex } = input;
	const attribution = { runId: input.runId, command: input.command };
	const issues: Array<(typeof MediaApplicationOutput.Type)["issues"][number]> = [];
	for (let step = 0; step < 48 && page < input.run.pages; step++) {
		const prepared = yield* replay.activity(`prepare:${batch}`, reader, {
			offset,
			dedupKey,
			itemIndex,
			ingestionArtifacts: {
				runId: input.runId,
				captures: { records: `${input.run.prefix}-${page}` },
			},
		});
		const sourceHandle = prepared.chunkHandles[0];
		if (!sourceHandle) {
			throw new Error("Media application did not return its source batch");
		}
		const sourceId = `application-source-${batch}`;
		yield* replay.child(`source:${batch}`, genericImportCaptureReference, {
			...attribution,
			operation: {
				action: "capture",
				ordinal: ordinal++,
				captureId: sourceId,
				phase: "collection",
				handle: sourceHandle,
				checkpoint: { page, offset: prepared.offset, stage: "application-source" },
			},
		});
		const written = yield* runMediaImportBatch(replay, {
			...attribution,
			batchIndex: batch,
			batch: prepared.batch,
			...(input.command.causation.integrationId
				? { integrationId: input.command.causation.integrationId }
				: {}),
			ingestionArtifacts: { runId: input.runId, captures: { batch: sourceId } },
		});
		const handle = written.chunkHandles[0];
		if (!handle) {
			throw new Error("Media writer did not return an application capture");
		}
		const captureId = `application-${batch}`;
		const batchId = `media-${batch}`;
		const applicationOrdinal = ordinal++;
		const captured = yield* replay.child(`capture:${batch}`, genericImportCaptureReference, {
			...attribution,
			operation: {
				handle,
				captureId,
				action: "capture",
				phase: "application",
				ordinal: applicationOrdinal,
				checkpoint: {
					page,
					stage: "application",
					offset: prepared.offset,
					dedupKey: prepared.dedupKey,
					itemIndex: prepared.itemIndex,
				},
			},
		});
		const applied = yield* replay.child(`apply:${batch}`, genericImportApplyReference, {
			...attribution,
			operation: {
				batchId,
				captureId,
				action: "apply",
				ordinal: applicationOrdinal,
				inputFingerprint: captured.inputFingerprint,
			},
		});
		appendMediaIssues(issues, applied.issues, input.issueLimit);
		if (confirm) {
			let start = 0;
			for (let part = 0; ; part++) {
				let end = start;
				let bytes = 2;
				while (end < applied.confirmed.length) {
					const value = applied.confirmed[end];
					const size = new TextEncoder().encode(JSON.stringify(value)).length + 1;
					if (end > start && bytes + size > 32 * 1024) {
						break;
					}
					if (size > 32 * 1024) {
						throw new Error("Media provider confirmation exceeds its bounded record size");
					}
					bytes += size;
					end++;
				}
				const final = end === applied.confirmed.length;
				const ingestionConfirmation: typeof MediaIntegrationConfirmation.Type = {
					part,
					final,
					batchId,
					runId: input.runId,
					inputFingerprint: captured.inputFingerprint,
					confirmed: applied.confirmed.slice(start, end),
				};
				yield* confirm(ingestionConfirmation, batch);
				if (final) {
					break;
				}
				start = end;
			}
		}
		offset = prepared.offset;
		itemIndex = prepared.itemIndex;
		dedupKey = prepared.dedupKey;
		batch++;
		if (prepared.done) {
			page++;
			offset = 0;
		}
	}
	return {
		page,
		batch,
		offset,
		issues,
		ordinal,
		dedupKey,
		itemIndex,
		done: page >= input.run.pages,
	};
}
