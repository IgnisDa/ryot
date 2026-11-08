import { defineWorkflowReference, type WorkflowStep } from "@ryot-app/plugin-backend-sdk/workflow";

import type { MediaSortedRun } from "./collection-schemas";
import { MediaMergeInput, MediaMergeOutput } from "./process";

const merger = defineWorkflowReference({
	input: MediaMergeInput,
	output: MediaMergeOutput,
	workflowSlug: "media-import-merge",
});
export const mediaSortedRuns = (
	step: WorkflowStep,
	attribution: Pick<typeof MediaMergeInput.Type, "runId" | "command">,
	state: { ordinal: number; runs: Array<null | MediaSortedRun> },
): {
	finish: (
		prefix: string,
	) => Generator<ReturnType<WorkflowStep["child"]>, null | MediaSortedRun, unknown>;
	add: (
		initial: MediaSortedRun,
		prefix: string,
	) => Generator<ReturnType<WorkflowStep["child"]>, void, unknown>;
} => {
	const merge = function* (
		left: MediaSortedRun,
		right: MediaSortedRun,
		prefix: string,
	): Generator<ReturnType<WorkflowStep["child"]>, MediaSortedRun, unknown> {
		const result = yield* step.child(`merge:${prefix}`, merger, {
			...attribution,
			left,
			right,
			prefix,
			page: 0,
			leftPage: 0,
			rightPage: 0,
			leftOffset: 0,
			rightOffset: 0,
			ordinal: state.ordinal,
		});
		state.ordinal = result.ordinal;
		return { prefix, pages: result.page };
	};
	return {
		finish: function* (prefix: string) {
			let result: null | MediaSortedRun = null;
			for (const [level, run] of state.runs.entries()) {
				if (run) {
					result = result ? yield* merge(result, run, `${prefix}-${level}`) : run;
				}
			}
			state.runs = [];
			return result;
		},
		add: function* (initial: MediaSortedRun, prefix: string) {
			let incoming = initial;
			for (let level = 0; ; level++) {
				const prior = state.runs[level];
				if (!prior) {
					state.runs[level] = incoming;
					return;
				}
				incoming = yield* merge(prior, incoming, `${prefix}-${level}`);
				state.runs[level] = null;
			}
		},
	};
};
