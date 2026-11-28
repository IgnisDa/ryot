import {
	AutomationBatchChangePayload,
	type AutomationTrigger,
} from "@ryot-app/contract/modules/automations/lifecycle";
import { SANDBOX_LIMITS } from "@ryot-app/sandbox/protocol/limits";
import { jsonByteLength, stableStringify } from "@ryot-app/ts-utils/json";
import { Effect, Schema } from "effect";

import { lifecycleTrigger } from "./command";
import type { LifecycleBatchChange, LifecycleBatchInput } from "./planning";

const decodeBatchPayload = Schema.decodeUnknownEffect(AutomationBatchChangePayload);

// Half the sandbox context limit leaves room for the invocation envelope and hook metadata.
const BATCH_PAYLOAD_BYTES = SANDBOX_LIMITS.execution.contextBytes / 2;

/**
 * Items in chunks of at most `maxItems` whose JSON fits half the sandbox context limit after
 * `baseBytes`, in the items' order. Items sharing a `subjectOf` key stay in one chunk, after the
 * subject's first item, so a subject over either bound gets a chunk of its own.
 */
export const lifecycleChunks = <Item>(
	items: ReadonlyArray<Item>,
	options: {
		readonly maxItems: number;
		readonly baseBytes: number;
		readonly sizeOf?: (item: Item) => unknown;
		readonly subjectOf?: (item: Item) => string;
	},
): ReadonlyArray<ReadonlyArray<Item>> => {
	const { subjectOf, sizeOf = (item: Item) => item } = options;
	const units = subjectOf
		? [...Map.groupBy(items, subjectOf).values()]
		: items.map((item) => [item]);
	const chunks: Item[][] = [];
	let chunk: Item[] = [];
	let bytes = options.baseBytes;
	for (const unit of units) {
		const size = unit.reduce((total, item) => total + (jsonByteLength(sizeOf(item)) ?? 0) + 1, 0);
		if (
			chunk.length > 0 &&
			(chunk.length + unit.length > options.maxItems || bytes + size > BATCH_PAYLOAD_BYTES)
		) {
			chunks.push(chunk);
			chunk = [];
			bytes = options.baseBytes;
		}
		chunk.push(...unit);
		bytes += size;
	}
	return chunk.length > 0 ? [...chunks, chunk] : chunks;
};

/**
 * Builds one batch trigger per scope and chunk covering committed changes. Chunks
 * respect both the item cap and the sandbox input budget; boundaries follow the caller's plan
 * order, so a replayed command reuses the same trigger ids.
 */
export const lifecycleBatchTriggers = Effect.fnUntraced(function* (
	input: LifecycleBatchInput,
	maxItems: number,
	changes: ReadonlyArray<LifecycleBatchChange>,
): Effect.fn.Return<ReadonlyArray<AutomationTrigger>> {
	const triggers: AutomationTrigger[] = [];
	const scopes = [...new Set(changes.map(({ scopeUserId }) => scopeUserId))].sort((left, right) =>
		(left ?? "").localeCompare(right ?? ""),
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
		const items = changes
			.filter((change) => change.scopeUserId === scopeUserId)
			.map((change) => change.payload)
			.filter(({ resource }) => resource === input.resource);
		const chunks = lifecycleChunks(items, {
			maxItems,
			baseBytes: jsonByteLength({ ...base, items: [] }) ?? 0,
		});
		for (const [chunkIndex, chunk] of chunks.entries()) {
			const payload = yield* decodeBatchPayload({ ...base, items: chunk }).pipe(Effect.orDie);
			triggers.push(yield* lifecycleTrigger(command, scopeUserId, payload, `batch:${chunkIndex}`));
		}
	}
	return triggers;
});
