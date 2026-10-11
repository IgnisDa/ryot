import { sandboxManifestSchema } from "@ryot-app/plugin-backend-sdk/core";
import { makeWorkflowReplayHost } from "@ryot-app/plugin-backend-sdk/testing";
import {
	defineManifest,
	defineWorkflow,
	Effect,
	Schema,
	workflowDurableCallRequestSchema,
} from "@ryot-app/plugin-backend-sdk/workflow";
import type {
	WorkflowReplayHost,
	WorkflowReplayJournalEntry,
} from "@ryot-app/plugin-backend-sdk/workflow";
import { Effect as RuntimeEffect } from "effect";
import { describe, expect, test } from "vitest";

class TestWorkflowFailure extends Error {
	readonly _tag = "TestWorkflowFailure";
}

describe("workflow definitions", () => {
	test("bootstraps once for value-dependent recorded steps and a pending next step", () =>
		RuntimeEffect.runPromise(
			RuntimeEffect.gen(function* () {
				const manifest = defineManifest({ name: "Replay", slug: "replay", kind: "workflow" });
				const workflow = defineWorkflow({
					manifest,
					output: Schema.Array(Schema.String),
					input: Schema.Struct({ value: Schema.Finite }),
					run: (input, replay) =>
						Effect.gen(function* () {
							const first = yield* replay.activity(
								"first",
								{
									output: Schema.String,
									scriptSlug: "activity.first",
									input: Schema.Struct({ value: Schema.Finite }),
								},
								input,
							);
							const second = yield* replay.child(
								"second",
								{
									output: Schema.String,
									workflowSlug: "workflow.second",
									input: Schema.Struct({ value: Schema.Finite }),
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
				const replayHost = makeWorkflowReplayHost(journal);
				const output = yield* workflow.run(
					{ value: 1 },
					{
						settleInline: replayHost.settleInline,
						replayJournal: () => {
							calls.push("bootstrap");
							return replayHost.replayJournal();
						},
					},
					{ metadata: {}, sandboxScriptId: "workflow-1" },
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
							kind: "child",
							name: "second",
							args: { input: { value: 1 }, workflowSlug: "workflow.second" },
						},
						{ index: 2, name: "next", kind: "sleep", args: { durationMs: 100 } },
					],
				});
				expect(calls).toHaveLength(1);
				expect(calls[0]).toBe("bootstrap");
			}),
		));

	test("emits parallel pending calls in deterministic order", () =>
		RuntimeEffect.runPromise(
			RuntimeEffect.gen(function* () {
				const manifest = defineManifest({
					kind: "workflow",
					name: "Parallel replay",
					slug: "parallel-replay",
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
					workflow.run(
						null,
						makeWorkflowReplayHost(
							values.map((value, index) => {
								const request = requests.at(index);
								if (!request) {
									throw new Error("Missing test request");
								}
								return { value, request };
							}),
						),
						{ metadata: {}, sandboxScriptId: "workflow-1" },
					);

				expect(yield* run([])).toEqual({
					state: "pending",
					journalLength: 0,
					requests: [
						{ index: 0, name: "first", kind: "sleep", args: { durationMs: 10 } },
						{ index: 1, kind: "sleep", name: "second", args: { durationMs: 20 } },
					],
				});
				expect(yield* run([null, null])).toEqual({
					journalLength: 2,
					state: "completed",
					output: ["first", "second"],
					requests: [
						{ index: 0, name: "first", kind: "sleep", args: { durationMs: 10 } },
						{ index: 1, kind: "sleep", name: "second", args: { durationMs: 20 } },
					],
				});
			}),
		));

	test("short_sleep_settles_inline_and_replays_without_waiting_again", () =>
		RuntimeEffect.runPromise(
			RuntimeEffect.gen(function* () {
				const workflow = defineWorkflow({
					input: Schema.Null,
					output: Schema.String,
					manifest: defineManifest({
						kind: "workflow",
						name: "Inline sleep",
						slug: "inline-sleep",
					}),
					run: (_input, replay) =>
						Effect.gen(function* () {
							yield* replay.sleep("first", 25);
							yield* replay.sleep("second", 75);
							return "finished";
						}),
				});
				const requests: Parameters<WorkflowReplayHost["settleInline"]>[0] = [
					{ index: 0, name: "first", kind: "sleep", args: { durationMs: 25 } },
					{ index: 1, kind: "sleep", name: "second", args: { durationMs: 75 } },
				];
				const batches: Array<Parameters<WorkflowReplayHost["settleInline"]>[0]> = [];
				const emptyHost = makeWorkflowReplayHost([]);
				const inlineHost: WorkflowReplayHost = {
					...emptyHost,
					settleInline: (batch) => {
						batches.push(batch);
						return RuntimeEffect.succeed(batch.map(() => null));
					},
				};
				const metadata = { metadata: {}, sandboxScriptId: "inline-sleep" };

				const firstRun = yield* workflow.run(null, inlineHost, metadata);
				expect(firstRun).toEqual({
					requests,
					journalLength: 0,
					state: "completed",
					output: "finished",
				});
				expect(batches).toEqual([requests.slice(0, 1), requests.slice(1)]);

				const journal: WorkflowReplayJournalEntry[] = requests.map((request) => ({
					request,
					value: null,
				}));
				const replayBase = makeWorkflowReplayHost(journal);
				const replayHost: WorkflowReplayHost = {
					...replayBase,
					settleInline: () => RuntimeEffect.die("Unexpected inline settlement during replay"),
				};
				const replayed = yield* workflow.run(null, replayHost, metadata);

				expect(replayed).toEqual({
					requests,
					journalLength: 2,
					state: "completed",
					output: "finished",
				});
			}),
		));

	test("settles registered parallel eligible sleeps in one ordered batch", () =>
		RuntimeEffect.runPromise(
			RuntimeEffect.gen(function* () {
				const workflow = defineWorkflow({
					input: Schema.Null,
					output: Schema.Array(Schema.String),
					manifest: defineManifest({
						kind: "workflow",
						name: "Parallel inline sleep",
						slug: "parallel-inline-sleep",
					}),
					run: (_input, replay) =>
						Effect.all([replay.sleep("first", 10), replay.sleep("second", 20)], {
							concurrency: "unbounded",
						}).pipe(Effect.as(["first", "second"])),
				});
				const batches: Array<Parameters<WorkflowReplayHost["settleInline"]>[0]> = [];
				const replayBase = makeWorkflowReplayHost([]);
				const replayHost: WorkflowReplayHost = {
					...replayBase,
					settleInline: (requests) => {
						batches.push(requests);
						return RuntimeEffect.succeed(requests.map(() => null));
					},
				};
				const envelope = yield* workflow.run(null, replayHost, {
					metadata: {},
					sandboxScriptId: "parallel-inline-sleep",
				});

				expect(envelope).toEqual({
					journalLength: 0,
					state: "completed",
					output: ["first", "second"],
					requests: [
						{ index: 0, name: "first", kind: "sleep", args: { durationMs: 10 } },
						{ index: 1, kind: "sleep", name: "second", args: { durationMs: 20 } },
					],
				});
				expect(batches).toEqual([
					[
						{ index: 0, name: "first", kind: "sleep", args: { durationMs: 10 } },
						{ index: 1, kind: "sleep", name: "second", args: { durationMs: 20 } },
					],
				]);
			}),
		));

	test("keeps inline sleeps pending when an activity or child reference is registered", () =>
		RuntimeEffect.runPromise(
			RuntimeEffect.gen(function* () {
				const workflow = defineWorkflow({
					input: Schema.Null,
					output: Schema.String,
					manifest: defineManifest({
						kind: "workflow",
						name: "Mixed inline calls",
						slug: "mixed-inline-calls",
					}),
					run: (_input, replay) =>
						Effect.all(
							[
								replay.sleep("pause", 10),
								replay.activity(
									"activity",
									{ input: Schema.Null, output: Schema.String, scriptSlug: "activity.work" },
									null,
								),
								replay.child(
									"child",
									{ input: Schema.Null, output: Schema.String, workflowSlug: "workflow.work" },
									null,
								),
							],
							{ concurrency: "unbounded" },
						).pipe(Effect.as("unreachable")),
				});
				const batches: Array<Parameters<WorkflowReplayHost["settleInline"]>[0]> = [];
				const replayBase = makeWorkflowReplayHost([]);
				const replayHost: WorkflowReplayHost = {
					...replayBase,
					settleInline: (requests) => {
						batches.push(requests);
						return RuntimeEffect.succeed(requests.map(() => null));
					},
				};
				const envelope = yield* workflow.run(null, replayHost, {
					metadata: {},
					sandboxScriptId: "mixed-inline-calls",
				});

				expect(envelope).toEqual({
					state: "pending",
					journalLength: 0,
					requests: [
						{ index: 0, name: "pause", kind: "sleep", args: { durationMs: 10 } },
						{
							index: 1,
							name: "activity",
							kind: "activity",
							args: { input: null, scriptSlug: "activity.work" },
						},
						{
							index: 2,
							name: "child",
							kind: "child",
							args: { input: null, workflowSlug: "workflow.work" },
						},
					],
				});
				expect(batches).toEqual([]);
			}),
		));

	test("defers inline sleeps and fails malformed settlement results", () =>
		RuntimeEffect.runPromise(
			RuntimeEffect.gen(function* () {
				const workflow = defineWorkflow({
					input: Schema.Null,
					output: Schema.Null,
					run: (_input, replay) => replay.sleep("pause", 10),
					manifest: defineManifest({
						kind: "workflow",
						name: "Deferred inline sleep",
						slug: "deferred-inline-sleep",
					}),
				});
				const metadata = { metadata: {}, sandboxScriptId: "deferred-inline-sleep" };
				const request = { index: 0, name: "pause", kind: "sleep", args: { durationMs: 10 } };
				const replayBase = makeWorkflowReplayHost([]);
				const pending = yield* workflow.run(
					null,
					{ ...replayBase, settleInline: () => RuntimeEffect.succeed(null) },
					metadata,
				);
				expect(pending).toEqual({ state: "pending", journalLength: 0, requests: [request] });

				const wrongCount = yield* workflow.run(
					null,
					{ ...replayBase, settleInline: () => RuntimeEffect.succeed([]) },
					metadata,
				);
				expect(wrongCount).toEqual({
					state: "failed",
					journalLength: 0,
					requests: [request],
					kind: "script-failure",
					error: "Error: Inline sleep results do not match the batch",
				});

				const nonNullValue = yield* workflow.run(
					null,
					{ ...replayBase, settleInline: () => RuntimeEffect.succeed(["not-null"]) },
					metadata,
				);
				expect(nonNullValue).toMatchObject({
					state: "failed",
					journalLength: 0,
					requests: [request],
					kind: "script-failure",
				});
			}),
		));

	test("reads only executed calls and preserves parallel registration order", () =>
		RuntimeEffect.runPromise(
			RuntimeEffect.gen(function* () {
				const manifest = defineManifest({
					kind: "workflow",
					name: "Lazy replay",
					slug: "lazy-replay",
				});
				const workflow = defineWorkflow({
					manifest,
					input: Schema.Null,
					output: Schema.Array(Schema.String),
					run: (_input, replay) =>
						Effect.gen(function* () {
							const results = yield* Effect.all(
								[
									replay.activity(
										"first",
										{ input: Schema.Null, output: Schema.String, scriptSlug: "activity.first" },
										null,
									),
									replay.activity(
										"second",
										{ input: Schema.Null, output: Schema.String, scriptSlug: "activity.second" },
										null,
									),
								],
								{ concurrency: "unbounded" },
							);
							if (results[0] === "continue") {
								yield* replay.sleep("unexecuted", 30);
							}
							return results;
						}),
				});
				const entries: WorkflowReplayJournalEntry[] = [
					{
						value: "one",
						request: {
							index: 0,
							name: "first",
							kind: "activity",
							args: { input: null, scriptSlug: "activity.first" },
						},
					},
					{
						value: "two",
						request: {
							index: 1,
							name: "second",
							kind: "activity",
							args: { input: null, scriptSlug: "activity.second" },
						},
					},
					{
						value: null,
						request: { index: 2, kind: "sleep", name: "unexecuted", args: { durationMs: 30 } },
					},
				];
				const reads: number[] = [];
				const output = yield* workflow.run(
					null,
					{
						settleInline: () => RuntimeEffect.succeed(null),
						replayJournal: () =>
							RuntimeEffect.succeed({
								length: entries.length,
								read: (index) =>
									RuntimeEffect.sync(() => reads.push(index)).pipe(
										RuntimeEffect.flatMap(() => {
											const entry = entries.at(index);
											return entry
												? RuntimeEffect.succeed(entry)
												: RuntimeEffect.fail({ message: `Missing test journal entry ${index}` });
										}),
									),
							}),
					},
					{ metadata: {}, sandboxScriptId: "lazy-replay" },
				);

				expect(output).toEqual({
					journalLength: 3,
					state: "completed",
					output: ["one", "two"],
					requests: [
						{
							index: 0,
							name: "first",
							kind: "activity",
							args: { input: null, scriptSlug: "activity.first" },
						},
						{
							index: 1,
							name: "second",
							kind: "activity",
							args: { input: null, scriptSlug: "activity.second" },
						},
					],
				});
				expect(reads).toEqual([0, 1]);
			}),
		));

	test("returns a completed replay envelope with validated output", () =>
		RuntimeEffect.runPromise(
			RuntimeEffect.gen(function* () {
				const manifest = defineManifest({ kind: "workflow", name: "Complete", slug: "complete" });
				const workflow = defineWorkflow({
					manifest,
					input: Schema.Null,
					output: Schema.String,
					run: (_input, replay) => replay.sleep("done", 10).pipe(Effect.as("completed-output")),
				});

				const output = yield* workflow.run(
					null,
					makeWorkflowReplayHost([
						{
							value: null,
							request: { index: 0, name: "done", kind: "sleep", args: { durationMs: 10 } },
						},
					]),
					{ metadata: {}, sandboxScriptId: "workflow-1" },
				);

				expect(output).toEqual({
					journalLength: 1,
					state: "completed",
					output: "completed-output",
					requests: [{ index: 0, name: "done", kind: "sleep", args: { durationMs: 10 } }],
				});
			}),
		));

	test("reports journal identity mismatches as failed replay envelopes", () =>
		RuntimeEffect.runPromise(
			RuntimeEffect.gen(function* () {
				const workflow = defineWorkflow({
					input: Schema.Null,
					output: Schema.Null,
					run: (_input, replay) => replay.sleep("expected", 10),
					manifest: defineManifest({ kind: "workflow", name: "Mismatch", slug: "mismatch" }),
				});

				const envelope = yield* workflow.run(
					null,
					makeWorkflowReplayHost([
						{
							value: null,
							request: { index: 0, name: "other", kind: "sleep", args: { durationMs: 10 } },
						},
					]),
					{ metadata: {}, sandboxScriptId: "mismatch" },
				);

				expect(envelope).toEqual({
					state: "failed",
					journalLength: 1,
					kind: "script-failure",
					error: "Error: Sandbox workflow journal identity mismatch at index 0",
					requests: [{ index: 0, kind: "sleep", name: "expected", args: { durationMs: 10 } }],
				});
			}),
		));

	test.each(["activity", "child"])("rejects non-JSON %s inputs", (kind) =>
		RuntimeEffect.runPromise(
			RuntimeEffect.gen(function* () {
				const manifest = defineManifest({
					kind: "workflow",
					name: "Invalid input",
					slug: "invalid-input",
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
									{
										input: Schema.Unknown,
										output: Schema.String,
										workflowSlug: "workflow.invalid",
									},
									input,
								),
				});

				const output = yield* workflow.run(undefined, makeWorkflowReplayHost([]), {
					metadata: {},
					sandboxScriptId: "workflow-1",
				});

				expect(output).toMatchObject({ requests: [], state: "failed" });
			}),
		),
	);

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

	test("rejects authored capabilities in workflow manifests", () => {
		const decode = Schema.decodeUnknownSync(sandboxManifestSchema);
		expect(decode({ kind: "workflow", name: "Workflow", slug: "workflow" })).toEqual({
			kind: "workflow",
			name: "Workflow",
			slug: "workflow",
		});
		expect(() =>
			decode({ kind: "workflow", capabilities: [], name: "Workflow", slug: "workflow" }),
		).toThrow();
		expect(() =>
			decode({ kind: "workflow", name: "Workflow", slug: "workflow", capabilities: ["httpCall"] }),
		).toThrow();
	});

	test("exports only deterministic workflow Effect combinators", () => {
		expect(Object.keys(Effect).sort()).toEqual(["all", "as", "fail", "gen", "succeed"]);
		expect(Reflect.get(Effect, "clockWith")).toBeUndefined();
		expect(Reflect.get(Effect, "randomWith")).toBeUndefined();
	});

	test.each([
		{
			message: "Error: invariant violated",
			failure: new TestWorkflowFailure("invariant violated"),
		},
		{
			message: "Sandbox artifact grant is unavailable",
			failure: { _tag: "SandboxFilesystemError", message: "Sandbox artifact grant is unavailable" },
		},
	])(
		"keeps durable requests and the failure message in a failed envelope: $message",
		({ failure, message }) =>
			RuntimeEffect.runPromise(
				RuntimeEffect.gen(function* () {
					const manifest = defineManifest({ name: "Failing", slug: "failing", kind: "workflow" });
					const workflow = defineWorkflow({
						manifest,
						output: Schema.String,
						input: Schema.Struct({}),
						run: (_input, replay) =>
							Effect.gen(function* () {
								yield* replay.activity(
									"step",
									{ output: Schema.String, input: Schema.Struct({}), scriptSlug: "activity.step" },
									{},
								);
								return yield* Effect.fail(failure);
							}),
					});

					const envelope = yield* workflow.run(
						{},
						makeWorkflowReplayHost([
							{
								value: "recorded",
								request: {
									index: 0,
									name: "step",
									kind: "activity",
									args: { input: {}, scriptSlug: "activity.step" },
								},
							},
						]),
						{ metadata: {}, sandboxScriptId: "failing" },
					);

					expect(envelope).toEqual({
						error: message,
						state: "failed",
						journalLength: 1,
						kind: "script-failure",
						requests: [
							{
								index: 0,
								name: "step",
								kind: "activity",
								args: { input: {}, scriptSlug: "activity.step" },
							},
						],
					});
				}),
			),
	);
	test.each([
		{
			data: { operation: "httpCall", code: "execution-limit" },
			failure: { message: "limit", data: { operation: "httpCall", code: "execution-limit" } },
		},
		{ data: undefined, failure: { message: "limit", data: { code: "not-a-boundary-code" } } },
		{ data: undefined, failure: new TestWorkflowFailure("no data") },
	])("carries a decoded boundary reason in a failed envelope: $data", ({ data, failure }) =>
		RuntimeEffect.runPromise(
			RuntimeEffect.gen(function* () {
				const manifest = defineManifest({ name: "Failing", slug: "failing", kind: "workflow" });
				const workflow = defineWorkflow({
					manifest,
					output: Schema.String,
					input: Schema.Struct({}),
					run: () => Effect.fail(failure),
				});

				const envelope = yield* workflow.run({}, makeWorkflowReplayHost([]), {
					metadata: {},
					sandboxScriptId: "failing",
				});

				expect(envelope).toMatchObject({ state: "failed", kind: "script-failure" });
				expect("data" in envelope).toBe(data !== undefined);
				if (data !== undefined) {
					expect(envelope).toMatchObject({ data });
				}
			}),
		),
	);
});
