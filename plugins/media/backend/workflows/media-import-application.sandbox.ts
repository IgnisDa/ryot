import { genericImportActivityReference } from "@ryot-app/plugin-backend-sdk/imports";
import { defineManifest, defineWorkflow, Effect } from "@ryot-app/plugin-backend-sdk/workflow";

import { applyMediaSegment } from "../imports/application-segment";
import { MediaApplicationInput, MediaApplicationOutput } from "../imports/process";
import { appendMediaIssues } from "../imports/reports";

export const manifest = defineManifest({
	kind: "workflow",
	name: "Apply captured media batches",
	slug: "workflow.media-import-application",
});
export default defineWorkflow({
	manifest,
	input: MediaApplicationInput,
	output: MediaApplicationOutput,
	checkpoint: MediaApplicationOutput,
	run: (input, step, checkpoint) =>
		Effect.gen(function* () {
			if (input.integrationScriptSlug !== null) {
				throw new Error("Media source application cannot select an integration adapter");
			}
			const issues = [...(checkpoint?.issues ?? [])];
			const result = yield* applyMediaSegment(
				{ ...input, ...checkpoint, issueLimit: input.issueLimit - issues.length },
				step,
			);
			appendMediaIssues(issues, result.issues, input.issueLimit);
			const next = { ...result, issues };
			yield* step.child("progress", genericImportActivityReference, {
				runId: input.runId,
				command: input.command,
				operation: {
					action: "activity",
					activity: {
						wait: null,
						batchId: null,
						parentId: null,
						kind: "writing",
						unit: "batches",
						exactTotal: null,
						id: "application",
						completed: result.batch,
						lastAdvancedAt: input.command.occurredAt,
						state: result.done ? "completed" : "running",
					},
				},
			});
			return next.done ? next : yield* step.save(next);
		}),
});
