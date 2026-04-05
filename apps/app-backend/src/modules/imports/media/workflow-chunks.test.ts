import { expect, it } from "@effect/vitest";

import { sandboxContextError } from "#lib/infrastructure/sandbox-runtime/limits";
import { SANDBOX_WORKFLOW_MAX_STEPS } from "#modules/sandbox/sandbox-script-workflow";

import { chunkWorkflowItems } from "./workflow-chunks";

it("splits ordered items across both context and durable-step budgets", () => {
	const items = Array.from({ length: 1_001 }, (_, index) => ({ index, value: `value-${index}` }));
	const { chunks, rejected } = chunkWorkflowItems(items.map((item) => ({ item, steps: 1 })));

	expect(rejected).toEqual([]);
	expect(chunks.map(({ items: chunk }) => chunk.length)).toEqual([1_000, 1]);
	expect(chunks.flatMap(({ items: chunk }) => chunk)).toEqual(items);
	for (const chunk of chunks) {
		expect(chunk.items.length).toBeLessThanOrEqual(SANDBOX_WORKFLOW_MAX_STEPS);
		expect(sandboxContextError({ items: chunk.items }, { kind: "workflow" })).toBeNull();
	}
});

it("uses worst-case resolution candidates as each item's step cost", () => {
	const items = Array.from({ length: 400 }, (_, index) => ({ index, value: `value-${index}` }));
	const { chunks } = chunkWorkflowItems(items.map((item) => ({ item, steps: 3 })));

	expect(chunks.map(({ items: chunk }) => chunk.length)).toEqual([333, 67]);
	expect(chunks.map(({ items: chunk }) => chunk.length * 3)).toEqual([999, 201]);
});

it("splits before the exact workflow context limit", () => {
	const items = Array.from({ length: 4 }, (_, index) => ({
		index,
		value: `${index}-${"x".repeat(20 * 1024)}`,
	}));
	const { chunks } = chunkWorkflowItems(items.map((item) => ({ item, steps: 1 })));

	expect(chunks).toHaveLength(2);
	expect(chunks.flatMap(({ items: chunk }) => chunk)).toEqual(items);
	for (const chunk of chunks) {
		expect(sandboxContextError({ items: chunk.items }, { kind: "workflow" })).toBeNull();
	}
});

it("admits the exact byte boundary and rejects one byte above it", () => {
	const empty = { index: 0, value: "" };
	const emptyBytes = new TextEncoder().encode(JSON.stringify({ items: [empty] })).byteLength;
	const exact = { ...empty, value: "x".repeat(64 * 1024 - emptyBytes) };
	const overflow = { ...exact, value: `${exact.value}x` };
	const result = chunkWorkflowItems([
		{ item: exact, steps: 1 },
		{ item: overflow, steps: 1 },
	]);

	expect(result.chunks).toHaveLength(1);
	expect(
		new TextEncoder().encode(JSON.stringify({ items: result.chunks[0]?.items })).byteLength,
	).toBe(64 * 1024);
	expect(result.rejected).toEqual([{ item: overflow, reason: "context" }]);
});

it("rejects only entries that cannot fit an empty valid chunk", () => {
	const circular: { self?: unknown } = {};
	circular.self = circular;
	const valid = { index: 0, value: "valid" };
	const oversized = { index: 1, value: "x".repeat(70 * 1024) };
	const tooManySteps = { index: 2, value: "steps" };
	const { chunks, rejected } = chunkWorkflowItems<unknown>([
		{ item: valid, steps: 1 },
		{ item: oversized, steps: 1 },
		{ item: tooManySteps, steps: SANDBOX_WORKFLOW_MAX_STEPS + 1 },
		{ item: circular, steps: 1 },
	]);

	expect(chunks.map(({ items }) => items)).toEqual([[valid]]);
	expect(rejected.map(({ reason }) => reason)).toEqual(["context", "steps", "json"]);
});
