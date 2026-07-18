import {
	AutomationBatchChangePayload,
	type AutomationTrigger,
} from "@ryot-app/contract/modules/automations/lifecycle";
import { jsonByteLength } from "@ryot-app/sandbox-compiler/limits";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { Schema } from "effect";

import { SANDBOX_LIMITS } from "#lib/infrastructure/sandbox-runtime/limits";

import type { LifecycleBatchInput, LifecyclePlan } from "./lifecycle";
import { lifecycleTrigger } from "./lifecycle-command";

const batchPayload = Schema.decodeUnknownSync(AutomationBatchChangePayload);

const changeItems = (plans: ReadonlyArray<LifecyclePlan>) =>
	plans.flatMap(({ trigger }) =>
		trigger.payload?.category === "change" && trigger.payload.operation !== "batch"
			? [trigger.payload]
			: [],
	);

// Half the sandbox context limit leaves room for the invocation envelope and hook metadata.
const BATCH_PAYLOAD_BYTES = SANDBOX_LIMITS.execution.contextBytes / 2;

const chunkItems = <Item>(
	items: ReadonlyArray<Item>,
	maxItems: number,
	baseBytes: number,
): ReadonlyArray<ReadonlyArray<Item>> => {
	const chunks: Item[][] = [];
	let chunk: Item[] = [];
	let bytes = baseBytes;
	for (const item of items) {
		const size = (jsonByteLength(item) ?? 0) + 1;
		if (chunk.length > 0 && (chunk.length >= maxItems || bytes + size > BATCH_PAYLOAD_BYTES)) {
			chunks.push(chunk);
			chunk = [];
			bytes = baseBytes;
		}
		chunk.push(item);
		bytes += size;
	}
	return chunk.length > 0 ? [...chunks, chunk] : chunks;
};

/**
 * Builds one batch trigger per scope and chunk covering the item plans one write produced. Chunks
 * respect both the item cap and the sandbox input budget; boundaries follow the caller's plan
 * order, so a replayed command reuses the same trigger ids.
 */
export const lifecycleBatchTriggers = (
	input: LifecycleBatchInput,
	maxItems: number,
): ReadonlyArray<AutomationTrigger> => {
	const triggers: AutomationTrigger[] = [];
	const scopes = [...new Set(input.plans.map(({ trigger }) => trigger.scopeUserId))].sort(
		(left, right) => (left ?? "").localeCompare(right ?? ""),
	);
	for (const scopeUserId of scopes) {
		const command = {
			...input.command,
			itemIdentity: stableStringify([
				input.command.itemIdentity,
				...input.identity,
				scopeUserId ?? "global",
			]),
		};
		const base = { category: "change", operation: "batch", resource: input.resource } as const;
		const items = changeItems(
			input.plans.filter(({ trigger }) => trigger.scopeUserId === scopeUserId),
		).filter(({ resource }) => resource === input.resource);
		const chunks = chunkItems(items, maxItems, jsonByteLength({ ...base, items: [] }) ?? 0);
		for (const [chunkIndex, chunk] of chunks.entries()) {
			triggers.push(
				lifecycleTrigger(
					command,
					scopeUserId,
					batchPayload({ ...base, items: chunk }),
					`batch:${chunkIndex}`,
				),
			);
		}
	}
	return triggers;
};
