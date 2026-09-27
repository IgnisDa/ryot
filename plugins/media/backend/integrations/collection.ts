import {
	genericImportActivityReference,
	genericImportCaptureReference,
} from "@ryot-app/sandbox-sdk/imports";
import { Schema, selectExecutable, type WorkflowReplay } from "@ryot-app/sandbox-sdk/workflow";

import type {
	MediaIntegrationCollectionInput,
	MediaIntegrationCollectionOutput,
} from "../imports/process";
import { mediaIntegrations } from "../imports/references";
import { mediaSortedRuns } from "../imports/sorted-runs";

export function* collectMediaIntegrationWindows(
	input: typeof MediaIntegrationCollectionInput.Type,
	replay: WorkflowReplay,
): Generator<
	ReturnType<WorkflowReplay["child"]>,
	typeof MediaIntegrationCollectionOutput.Type,
	unknown
> {
	const context = yield* Schema.decodeUnknownEffect(Schema.Record(Schema.String, Schema.Unknown))(
		input.integrationContext,
	);
	const source = selectExecutable(mediaIntegrations, input.integrationScriptSlug);
	const attribution = { runId: input.runId, command: input.command };
	const state = { ordinal: input.ordinal };
	const runs = mediaSortedRuns(replay, attribution, state);
	let { page, carry } = input;
	let done = false;
	let sourceFailure: typeof MediaIntegrationCollectionOutput.Type.sourceFailure;
	for (let boundary = 0; boundary < 64; boundary++) {
		const collected = yield* replay.activity(`integration-collector:${page}`, source, {
			...context,
			...(carry ? { ingestionArtifacts: { runId: input.runId, captures: { carry } } } : {}),
		});
		const prefix = `integration-source-${page}`;
		sourceFailure = collected.sourceFailure;
		const handle = collected.chunkHandles[0];
		if (handle) {
			const captureId = `${prefix}-0`;
			yield* replay.child(`capture:${captureId}`, genericImportCaptureReference, {
				...attribution,
				operation: {
					handle,
					captureId,
					action: "capture",
					phase: "collection",
					ordinal: state.ordinal++,
					checkpoint: { offset: page, stage: "collection" },
				},
			});
			yield* runs.add({ prefix, pages: 1 }, `integration-sort-${page}`);
		}
		carry = null;
		if (collected.carryFile) {
			const carryHandle = collected.chunkHandles[1];
			if (!carryHandle) {
				throw new Error("Media integration window is missing its carry");
			}
			carry = `${prefix}-carry`;
			yield* replay.child(`capture:${carry}`, genericImportCaptureReference, {
				...attribution,
				operation: {
					captureId: carry,
					action: "capture",
					handle: carryHandle,
					phase: "collection",
					ordinal: state.ordinal++,
					checkpoint: { offset: page, stage: "integration-carry" },
				},
			});
		}
		page++;
		if (collected.advancedAt) {
			yield* replay.child(`progress:${page}`, genericImportActivityReference, {
				...attribution,
				operation: {
					action: "activity",
					activity: {
						wait: null,
						batchId: null,
						parentId: null,
						kind: "reading",
						unit: "windows",
						completed: page,
						id: "collection",
						exactTotal: carry ? null : page,
						lastAdvancedAt: collected.advancedAt,
						state: carry ? "running" : "completed",
					},
				},
			});
		}
		if (!carry || sourceFailure) {
			done = true;
			break;
		}
	}
	const run = yield* runs.finish(`integration-collected-${input.page}`);
	return {
		page,
		done,
		carry,
		run: run ?? null,
		ordinal: state.ordinal,
		...(sourceFailure ? { sourceFailure } : {}),
	};
}
