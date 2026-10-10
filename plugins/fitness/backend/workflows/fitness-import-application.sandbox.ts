import {
	genericImportActivityReference,
	genericImportApplyReference,
	genericImportCaptureReference,
} from "@ryot-app/sandbox-sdk/imports";
import {
	defineManifest,
	defineWorkflow,
	Effect,
	selectExecutable,
} from "@ryot-app/sandbox-sdk/workflow";

import { fitnessParsers } from "../imports/references";
import { FitnessApplicationInput, FitnessApplicationOutput } from "../imports/schemas";

export const manifest = defineManifest({
	kind: "workflow",
	slug: "workflow.import-application",
	name: "Apply Fitness import captures",
});

export class FitnessApplicationError extends Error {
	readonly _tag = "FitnessApplicationError";
}

export default defineWorkflow({
	manifest,
	input: FitnessApplicationInput,
	output: FitnessApplicationOutput,
	run: (input, replay) =>
		Effect.gen(function* () {
			const parser = selectExecutable(fitnessParsers, input.parser);
			const attribution = { runId: input.runId, command: input.command };
			let page = input.page;
			let batch = input.batch;
			let offset = input.offset;
			let ordinal = input.ordinal;
			let completed = input.completed;
			let advancedAt = input.command.occurredAt;
			let issues: (typeof FitnessApplicationOutput.Type)["issues"] = [];
			for (let iteration = 0; iteration < 32 && page < input.run.pages; iteration++) {
				const captureId = `${input.run.prefix}-${page}`;
				const prepared = yield* replay.activity(`application:${batch}`, parser, {
					offset,
					action: "application",
					ingestionArtifacts: { runId: input.runId, captures: { records: captureId } },
				});
				const handle = prepared.chunkHandles[0];
				if (!handle) {
					return yield* Effect.fail(
						new FitnessApplicationError("Fitness application did not return a capture"),
					);
				}
				const id = `application-${batch}`;
				const captured = yield* replay.child(`capture:${id}`, genericImportCaptureReference, {
					...attribution,
					operation: {
						handle,
						ordinal,
						captureId: id,
						action: "capture",
						phase: "application",
						checkpoint: { page, stage: "application", offset: prepared.offset },
					},
				});
				const applied = yield* replay.child(`apply:${batch}`, genericImportApplyReference, {
					...attribution,
					operation: {
						ordinal,
						batchId: id,
						captureId: id,
						action: "apply",
						inputFingerprint: captured.inputFingerprint,
					},
				});
				issues = [...issues, ...applied.issues].slice(0, input.issueLimit);
				completed += applied.summary
					.filter((dimension) => dimension.unit === input.unit)
					.reduce(
						(sum, dimension) =>
							sum + Object.values(dimension.counts).reduce((count, value) => count + value, 0),
						0,
					);
				advancedAt = prepared.advancedAt;
				yield* replay.child(`activity:application:${batch}`, genericImportActivityReference, {
					...attribution,
					operation: {
						action: "activity",
						activity: {
							completed,
							wait: null,
							batchId: null,
							parentId: null,
							kind: "writing",
							unit: input.unit,
							state: "running",
							exactTotal: null,
							id: "application",
							lastAdvancedAt: advancedAt,
						},
					},
				});
				ordinal++;
				batch++;
				offset = prepared.offset;
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
				completed,
				advancedAt,
				done: page === input.run.pages,
			};
		}),
});
