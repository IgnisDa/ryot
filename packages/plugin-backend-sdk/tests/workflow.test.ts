import { expect } from "bun:test";

import { driveWorkflowReplay, makeWorkflowReplayHost } from "@ryot-app/plugin-backend-sdk/testing";
import {
	defineManifest,
	defineScriptReference,
	defineWorkflow,
	Effect,
	Schema,
} from "@ryot-app/plugin-backend-sdk/workflow";
import { it } from "@voila.dev/effect-bun-test";
import { Effect as RuntimeEffect } from "effect";

const manifest = defineManifest({ kind: "workflow", name: "Batch import", slug: "batch-import" });
const batch = defineScriptReference({
	input: Schema.Int,
	scriptSlug: "batch",
	output: Schema.String,
});

it.effect("resumes from the saved batch without replaying completed batches", () =>
	RuntimeEffect.gen(function* () {
		const workflow = defineWorkflow({
			manifest,
			input: Schema.Int,
			output: Schema.Array(Schema.String),
			checkpoint: Schema.Struct({ next: Schema.Int, values: Schema.Array(Schema.String) }),
			run: (total, step, checkpoint) =>
				Effect.gen(function* () {
					const next = checkpoint?.next ?? 0;
					const values = checkpoint?.values ?? [];
					if (next === total) {
						return { output: values };
					}
					const value = yield* step.activity("batch", batch, next);
					return yield* step.save({ next: next + 1, values: [...values, value] });
				}),
		});
		const requests: unknown[] = [];
		const result = yield* driveWorkflowReplay(workflow.run, 3, (request) => {
			requests.push(request);
			return `batch-${requests.length}`;
		});
		expect(result).toEqual({
			requests: [],
			journalLength: 0,
			state: "completed",
			output: ["batch-1", "batch-2", "batch-3"],
		});
		expect(requests).toEqual(
			[0, 1, 2].map((input) => ({
				index: 0,
				name: "batch",
				kind: "activity",
				args: { input, scriptSlug: "batch" },
			})),
		);
	}),
);

it.effect("keeps the unfinished step's calls tied to their original inputs", () =>
	RuntimeEffect.gen(function* () {
		const workflow = defineWorkflow({
			manifest,
			input: Schema.Int,
			output: Schema.String,
			run: (input, step) =>
				step.activity("batch", batch, input).pipe(RuntimeEffect.map((output) => ({ output }))),
		});
		const result = yield* workflow.run(
			2,
			makeWorkflowReplayHost([
				{
					value: "first",
					request: {
						index: 0,
						name: "batch",
						kind: "activity",
						args: { input: 1, scriptSlug: "batch" },
					},
				},
			]),
			{ metadata: {}, sandboxScriptId: "test" },
		);
		expect(result).toMatchObject({ state: "failed", kind: "script-failure" });
	}),
);

it.effect("preserves external ambiguity through a bounded step", () =>
	RuntimeEffect.gen(function* () {
		const workflow = defineWorkflow({
			manifest,
			input: Schema.Null,
			output: Schema.Null,
			run: () =>
				Effect.fail({ message: "Delivery outcome unknown", data: { code: "external-uncertain" } }),
		});
		const result = yield* workflow.run(null, makeWorkflowReplayHost([]), {
			metadata: {},
			sandboxScriptId: "test",
		});
		expect(result).toMatchObject({
			state: "failed",
			kind: "external-uncertain",
			error: "Delivery outcome unknown",
		});
	}),
);

it.effect("registers bounded parallel work before yielding", () =>
	RuntimeEffect.gen(function* () {
		const workflow = defineWorkflow({
			manifest,
			input: Schema.Null,
			output: Schema.Array(Schema.String),
			run: (_input, step) =>
				Effect.all([step.activity("one", batch, 1), step.activity("two", batch, 2)], {
					concurrency: "unbounded",
				}).pipe(RuntimeEffect.map((output) => ({ output }))),
		});
		const result = yield* workflow.run(null, makeWorkflowReplayHost([]), {
			metadata: {},
			sandboxScriptId: "test",
		});
		expect(result).toMatchObject({
			state: "pending",
			journalLength: 0,
			requests: [
				{ index: 0, name: "one", args: { input: 1 } },
				{ index: 1, name: "two", args: { input: 2 } },
			],
		});
	}),
);

const changes = (value: string) => ({
	signals: [{ discriminator: value, properties: { value }, schemaSlug: "batch-done" }],
});

it.effect("carries a step's changes on its checkpoint and its completion", () =>
	RuntimeEffect.gen(function* () {
		const workflow = defineWorkflow({
			manifest,
			input: Schema.Int,
			output: Schema.Int,
			checkpoint: Schema.Int,
			run: (total, step, checkpoint) =>
				Effect.gen(function* () {
					const next = checkpoint ?? 0;
					if (next === total) {
						return { output: next, changes: changes("done") };
					}
					return yield* step.save(next + 1, changes(`step-${next}`));
				}),
		});
		const first = yield* workflow.run(1, makeWorkflowReplayHost([]), {
			metadata: {},
			sandboxScriptId: "test",
		});
		expect(first).toMatchObject({ checkpoint: 1, state: "checkpoint", changes: changes("step-0") });
		const last = yield* workflow.run(
			1,
			{ ...makeWorkflowReplayHost([]), checkpoint: 1 },
			{ metadata: {}, sandboxScriptId: "test" },
		);
		expect(last).toMatchObject({ output: 1, state: "completed", changes: changes("done") });
	}),
);
