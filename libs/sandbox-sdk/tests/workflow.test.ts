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
		const output = await RuntimeEffect.runPromise(
			workflow.run(
				{ value: 1 },
				{
					durableCalls: () => {
						calls.push("bootstrap");
						return Effect.succeed(["one", "two"]);
					},
				},
				{ metadata: {}, sandboxScriptId: "workflow-1" },
			),
		);

		expect(output).toEqual({
			state: "pending",
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

	test("returns a completed replay envelope with validated output", async () => {
		const manifest = defineManifest({
			kind: "workflow",
			capabilities: [],
			name: "Complete",
			slug: "complete",
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
				{ durableCalls: () => Effect.succeed([null]) },
				{ metadata: {}, sandboxScriptId: "workflow-1" },
			),
		);

		expect(output).toEqual({
			output: "completed-output",
			state: "completed",
			requests: [{ index: 0, name: "done", kind: "sleep", args: { durationMs: 10 } }],
		});
	});

	test("validates direct durable call request shapes", () => {
		const decode = Schema.decodeUnknownSync(workflowDurableCallRequestSchema);
		expect(
			decode({
				index: 0,
				name: "wait",
				kind: "sleep",
				args: { durationMs: 1000 },
			}),
		).toEqual({ index: 0, name: "wait", kind: "sleep", args: { durationMs: 1000 } });
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
		expect(Object.keys(Effect).sort()).toEqual(["as", "gen", "succeed"]);
		expect(Reflect.get(Effect, "clockWith")).toBeUndefined();
		expect(Reflect.get(Effect, "randomWith")).toBeUndefined();
	});
});
