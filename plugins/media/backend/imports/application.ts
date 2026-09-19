import { genericImportActivityReference } from "@ryot-app/sandbox-sdk/imports";
import type { WorkflowReplay } from "@ryot-app/sandbox-sdk/workflow";

import type { MediaApplicationInput, MediaApplicationOutput } from "./process";
import { appendMediaIssues } from "./reports";

export function* applyMediaSegments(
	input: typeof MediaApplicationInput.Type,
	replay: WorkflowReplay,
	segment: (
		part: number,
		input: typeof MediaApplicationInput.Type,
	) => Generator<ReturnType<WorkflowReplay["child"]>, typeof MediaApplicationOutput.Type, unknown>,
): Generator<ReturnType<WorkflowReplay["child"]>, typeof MediaApplicationOutput.Type, unknown> {
	let current: typeof MediaApplicationOutput.Type = {
		issues: [],
		done: false,
		page: input.page,
		batch: input.batch,
		offset: input.offset,
		ordinal: input.ordinal,
		dedupKey: input.dedupKey,
		itemIndex: input.itemIndex,
	};
	const issues: Array<(typeof MediaApplicationOutput.Type)["issues"][number]> = [];
	for (let part = 0; part < 64; part++) {
		current = yield* segment(part, {
			...input,
			page: current.page,
			batch: current.batch,
			offset: current.offset,
			ordinal: current.ordinal,
			dedupKey: current.dedupKey,
			itemIndex: current.itemIndex,
			issueLimit: input.issueLimit - issues.length,
		});
		appendMediaIssues(issues, current.issues, input.issueLimit);
		yield* replay.child(`progress:${part}`, genericImportActivityReference, {
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
					completed: current.batch,
					lastAdvancedAt: input.command.occurredAt,
					state: current.done ? "completed" : "running",
				},
			},
		});
		if (current.done) {
			break;
		}
	}
	return { ...current, issues };
}
