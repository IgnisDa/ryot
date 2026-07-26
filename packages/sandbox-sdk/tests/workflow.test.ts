import { sandboxManifestSchema } from "@ryot/sandbox-sdk/core";
import {
	defineManifest,
	defineWorkflow,
	Effect,
	Schema,
	workflowDurableCallRequestSchema,
} from "@ryot/sandbox-sdk/workflow";
import { Effect as RuntimeEffect } from "effect";
import { describe, expect, test } from "vitest";

describe("workflow definitions", () => {
	test("bootstraps once for value-dependent recorded steps and a pending next step", async () => {
		const manifest = defineManifest({
			kind: "workflow",
			capabilities: [],
			name: "Replay",
			slug: "replay",
			requiredPluginConfigKeys: [],
			requiredSystemConfigKeys: [],
		});
		const workflow = defineWorkflow({
			manifest,
			input: Schema.Struct({ value: Schema.Number }),
			output: Schema.Array(Schema.String),
			run: (input, replay) =>
				Effect.gen(function* () {
					const first = yield* replay.activity(
						"first",
						{
							scriptSlug: "activity.first",
							input: Schema.Struct({ value: Schema.Number }),
							output: Schema.String,
						},
						input,
					);
					const second = yield* replay.child(
						"second",
						{
							workflowSlug: "workflow.second",
							input: Schema.Struct({ value: Schema.Number }),
							output: Schema.String,
						},
						input,
					);
					if (first === "one" && second === "two") {
						yield* replay.sleep("next", 100);
					}
					return [first, second];
				}),
		});
		const calls: unknown[] = [];
		const journal = [
			{
				value: "one",
				request: {
					index: 0,
					name: "first",
					kind: "activity" as const,
					args: { input: { value: 1 }, scriptSlug: "activity.first" },
				},
			},
			{
				value: "two",
				request: {
					index: 1,
					name: "second",
					kind: "child" as const,
					args: { input: { value: 1 }, workflowSlug: "workflow.second" },
				},
			},
		];
		const output = await RuntimeEffect.runPromise(
			workflow.run(
				{ value: 1 },
				{
					durableCalls: () => {
						calls.push("bootstrap");
						return Effect.succeed(journal);
					},
				},
				{ metadata: {}, sandboxScriptId: "workflow-1" },
			),
		);

		expect(output).toEqual({
			state: "pending",
			journalLength: 2,
			requests: [
				{
					index: 0,
					name: "first",
					kind: "activity",
					args: { input: { value: 1 }, scriptSlug: "activity.first" },
				},
				{
					index: 1,
					name: "second",
					kind: "child",
					args: { input: { value: 1 }, workflowSlug: "workflow.second" },
				},
				{ index: 2, name: "next", kind: "sleep", args: { durationMs: 100 } },
			],
		});
		expect(calls).toHaveLength(1);
		expect(calls[0]).toBe("bootstrap");
	});

	test("emits parallel pending calls in deterministic order", async () => {
		const manifest = defineManifest({
			kind: "workflow",
			capabilities: [],
			name: "Parallel replay",
			slug: "parallel-replay",
			requiredPluginConfigKeys: [],
			requiredSystemConfigKeys: [],
		});
		const workflow = defineWorkflow({
			manifest,
			input: Schema.Null,
			output: Schema.Array(Schema.String),
			run: (_input, replay) =>
				Effect.all([replay.sleep("first", 10), replay.sleep("second", 20)], {
					concurrency: "unbounded",
				}).pipe(Effect.as(["first", "second"])),
		});
		const requests = [
			{ index: 0, name: "first", kind: "sleep" as const, args: { durationMs: 10 } },
			{ index: 1, name: "second", kind: "sleep" as const, args: { durationMs: 20 } },
		];
		const run = (values: ReadonlyArray<null>) =>
			RuntimeEffect.runPromise(
				workflow.run(
					null,
					{
						durableCalls: () =>
							Effect.succeed(
								values.map((value, index) => {
									const request = requests[index];
									if (!request) {
										throw new Error("Missing test request");
									}
									return { value, request };
								}),
							),
					},
					{ metadata: {}, sandboxScriptId: "workflow-1" },
				),
			);

		expect(await run([])).toEqual({
			state: "pending",
			journalLength: 0,
			requests: [
				{ index: 0, name: "first", kind: "sleep", args: { durationMs: 10 } },
				{ index: 1, name: "second", kind: "sleep", args: { durationMs: 20 } },
			],
		});
		expect(await run([null, null])).toEqual({
			journalLength: 2,
			state: "completed",
			output: ["first", "second"],
			requests: [
				{ index: 0, name: "first", kind: "sleep", args: { durationMs: 10 } },
				{ index: 1, name: "second", kind: "sleep", args: { durationMs: 20 } },
			],
		});
	});

	test("returns a completed replay envelope with validated output", async () => {
		const manifest = defineManifest({
			kind: "workflow",
			name: "Complete",
			slug: "complete",
			capabilities: [],
			requiredPluginConfigKeys: [],
			requiredSystemConfigKeys: [],
		});
		const workflow = defineWorkflow({
			manifest,
			input: Schema.Null,
			output: Schema.String,
			run: (_input, replay) => replay.sleep("done", 10).pipe(Effect.as("completed-output")),
		});

		const output = await RuntimeEffect.runPromise(
			workflow.run(
				null,
				{
					durableCalls: () =>
						Effect.succeed([
							{
								value: null,
								request: {
									index: 0,
									name: "done",
									kind: "sleep" as const,
									args: { durationMs: 10 },
								},
							},
						]),
				},
				{ metadata: {}, sandboxScriptId: "workflow-1" },
			),
		);

		expect(output).toEqual({
			journalLength: 1,
			state: "completed",
			output: "completed-output",
			requests: [{ index: 0, name: "done", kind: "sleep", args: { durationMs: 10 } }],
		});
	});

	test.each(["activity", "child"])("rejects non-JSON %s inputs", async (kind) => {
		const manifest = defineManifest({
			kind: "workflow",
			capabilities: [],
			name: "Invalid input",
			slug: "invalid-input",
			requiredPluginConfigKeys: [],
			requiredSystemConfigKeys: [],
		});
		const workflow = defineWorkflow({
			manifest,
			input: Schema.Unknown,
			output: Schema.String,
			run: (input, replay) =>
				kind === "activity"
					? replay.activity(
							"invalid",
							{ input: Schema.Unknown, output: Schema.String, scriptSlug: "activity.invalid" },
							input,
						)
					: replay.child(
							"invalid",
							{ input: Schema.Unknown, output: Schema.String, workflowSlug: "workflow.invalid" },
							input,
						),
		});

		const output = await RuntimeEffect.runPromise(
			workflow.run(
				undefined,
				{ durableCalls: () => Effect.succeed([]) },
				{ metadata: {}, sandboxScriptId: "workflow-1" },
			),
		);

		expect(output).toMatchObject({ state: "failed", requests: [] });
	});

	test("validates direct durable call request shapes", () => {
		const decode = Schema.decodeUnknownSync(workflowDurableCallRequestSchema);
		expect(decode({ index: 0, name: "wait", kind: "sleep", args: { durationMs: 1000 } })).toEqual({
			index: 0,
			name: "wait",
			kind: "sleep",
			args: { durationMs: 1000 },
		});
		expect(() =>
			decode({
				index: 0,
				name: "activity",
				kind: "activity",
				args: { input: {}, operation: "resolve", scriptSlug: "activity.resolve" },
			}),
		).toThrow();
	});

	test("requires workflow manifests to declare no normal capabilities", () => {
		const decode = Schema.decodeUnknownSync(sandboxManifestSchema);
		expect(
			decode({
				kind: "workflow",
				capabilities: [],
				name: "Workflow",
				slug: "workflow",
				requiredPluginConfigKeys: [],
				requiredSystemConfigKeys: [],
			}),
		).toMatchObject({ kind: "workflow", capabilities: [] });
		expect(() =>
			decode({
				kind: "workflow",
				name: "Workflow",
				slug: "workflow",
				capabilities: ["httpCall"],
				requiredPluginConfigKeys: [],
				requiredSystemConfigKeys: [],
			}),
		).toThrow();
	});

	test("exports only deterministic workflow Effect combinators", () => {
		expect(Object.keys(Effect).sort()).toEqual(["all", "as", "fail", "gen", "succeed"]);
		expect(Reflect.get(Effect, "clockWith")).toBeUndefined();
		expect(Reflect.get(Effect, "randomWith")).toBeUndefined();
	});

	test("turns a workflow body failure into a failed envelope keeping its durable requests", async () => {
		const manifest = defineManifest({
			name: "Failing",
			slug: "failing",
			kind: "workflow",
			capabilities: [],
			requiredPluginConfigKeys: [],
			requiredSystemConfigKeys: [],
		});
		const workflow = defineWorkflow({
			manifest,
			output: Schema.String,
			input: Schema.Struct({}),
			run: (_input, replay) =>
				Effect.gen(function* () {
					yield* replay.activity(
						"step",
						{ input: Schema.Struct({}), output: Schema.String, scriptSlug: "activity.step" },
						{},
					);
					return yield* Effect.fail(new Error("invariant violated"));
				}),
		});

		const envelope = await RuntimeEffect.runPromise(
			workflow.run(
				{},
				{
					durableCalls: () =>
						RuntimeEffect.succeed([
							{
								value: "recorded",
								request: {
									index: 0,
									name: "step",
									kind: "activity" as const,
									args: { input: {}, scriptSlug: "activity.step" },
								},
							},
						]),
				},
				{ metadata: {}, sandboxScriptId: "failing" },
			),
		);

		expect(envelope).toEqual({
			state: "failed",
			journalLength: 1,
			error: "Error: invariant violated",
			requests: [
				{
					index: 0,
					name: "step",
					kind: "activity",
					args: { input: {}, scriptSlug: "activity.step" },
				},
			],
		});
	});
});
