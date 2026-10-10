import { defineWorkflowReference, type WorkflowReplay } from "@ryot-app/sandbox-sdk/workflow";

import type { MediaSortedRun } from "./collection-schemas";
import { MediaMergeInput, MediaMergeOutput } from "./process";

const merger = defineWorkflowReference({
	input: MediaMergeInput,
	output: MediaMergeOutput,
	workflowSlug: "media-import-merge",
});
export const mediaSortedRuns = (
	replay: WorkflowReplay,
	attribution: Pick<typeof MediaMergeInput.Type, "runId" | "command">,
	state: { ordinal: number },
): {
	add: (
		initial: MediaSortedRun,
		prefix: string,
	) => Generator<ReturnType<WorkflowReplay["child"]>, void, unknown>;
	finish: (
		prefix: string,
	) => Generator<ReturnType<WorkflowReplay["child"]>, MediaSortedRun | null, unknown>;
} => {
	let runs: Array<MediaSortedRun | undefined> = [];
	const merge = function* (
		left: MediaSortedRun,
		right: MediaSortedRun,
		prefix: string,
	): Generator<ReturnType<WorkflowReplay["child"]>, MediaSortedRun, unknown> {
		let page = 0;
		let leftPage = 0;
		let rightPage = 0;
		let leftOffset = 0;
		let rightOffset = 0;
		for (let segment = 0; ; segment++) {
			const result = yield* replay.child(`merge:${prefix}:${segment}`, merger, {
				...attribution,
				left,
				page,
				right,
				prefix,
				leftPage,
				rightPage,
				leftOffset,
				rightOffset,
				ordinal: state.ordinal,
			});
			({ page, leftPage, rightPage, leftOffset, rightOffset } = result);
			state.ordinal = result.ordinal;
			if (result.done) {
				return { prefix, pages: page };
			}
		}
	};
	return {
		finish: function* (prefix: string) {
			let result: MediaSortedRun | null = null;
			for (const [level, run] of runs.entries()) {
				if (run) {
					result = result ? yield* merge(result, run, `${prefix}-${level}`) : run;
				}
			}
			runs = [];
			return result;
		},
		add: function* (initial: MediaSortedRun, prefix: string) {
			let incoming = initial;
			for (let level = 0; ; level++) {
				const prior = runs[level];
				if (!prior) {
					runs[level] = incoming;
					return;
				}
				incoming = yield* merge(prior, incoming, `${prefix}-${level}`);
				runs[level] = undefined;
			}
		},
	};
};
