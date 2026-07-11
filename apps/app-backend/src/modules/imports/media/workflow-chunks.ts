import {
	jsonByteLength,
	WORKFLOW_SANDBOX_LIMITS,
} from "#lib/infrastructure/sandbox-runtime/limits";
import { SANDBOX_WORKFLOW_MAX_STEPS } from "#modules/sandbox/sandbox-script-workflow";

const emptyItemsContextBytes = jsonByteLength({ items: [] }) ?? 0;

export type WorkflowChunkRejection = "context" | "json" | "steps";

export const chunkWorkflowItems = <Item>(entries: ReadonlyArray<{ item: Item; steps: number }>) => {
	const chunks: Array<{ items: Item[] }> = [];
	const rejected: Array<{ item: Item; reason: WorkflowChunkRejection }> = [];
	let items: Item[] = [];
	let steps = 0;
	let contextBytes = emptyItemsContextBytes;

	for (const entry of entries) {
		const itemBytes = jsonByteLength(entry.item);
		if (itemBytes === null) {
			rejected.push({ item: entry.item, reason: "json" });
			continue;
		}
		if (emptyItemsContextBytes + itemBytes > WORKFLOW_SANDBOX_LIMITS.execution.contextBytes) {
			rejected.push({ item: entry.item, reason: "context" });
			continue;
		}
		if (
			!Number.isSafeInteger(entry.steps) ||
			entry.steps <= 0 ||
			entry.steps > SANDBOX_WORKFLOW_MAX_STEPS
		) {
			rejected.push({ item: entry.item, reason: "steps" });
			continue;
		}

		const separatorBytes = items.length === 0 ? 0 : 1;
		if (
			contextBytes + separatorBytes + itemBytes > WORKFLOW_SANDBOX_LIMITS.execution.contextBytes ||
			steps + entry.steps > SANDBOX_WORKFLOW_MAX_STEPS
		) {
			chunks.push({ items });
			items = [];
			steps = 0;
			contextBytes = emptyItemsContextBytes;
		}

		contextBytes += (items.length === 0 ? 0 : 1) + itemBytes;
		items.push(entry.item);
		steps += entry.steps;
	}

	if (items.length > 0) {
		chunks.push({ items });
	}

	return { chunks, rejected };
};
