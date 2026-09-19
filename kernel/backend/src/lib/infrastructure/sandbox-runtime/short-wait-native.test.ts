import { assert, expect, layer } from "@effect/vitest";
import { SandboxScriptManifest } from "@ryot-app/contract/modules/sandbox/schemas";
import { compileBuiltInSandboxEntry } from "@ryot-app/sandbox-compiler/builtins";
import type { WorkflowReplayJournalEntry } from "@ryot-app/sandbox-sdk/workflow";
import { Effect, Schema } from "effect";

import { runNative, runnerNativeLayer } from "./runner-native.test-support";
import type { SandboxInlineDurableHost } from "./shared";

const compileFixture = Effect.fnUntraced(function* (source: string) {
	const result = yield* compileBuiltInSandboxEntry({
		entry: "script.ts",
		files: { "script.ts": source },
	});
	const manifest = yield* Schema.decodeUnknownEffect(SandboxScriptManifest)(
		result.compiled.manifest,
	);
	return { manifest, format: result.compiled.format, javascript: result.compiled.javascript };
});

layer(runnerNativeLayer, { excludeTestServices: true })((test) => {
	test.effect("short_sleep_continues_live_before_long_wait_defers", () =>
		Effect.gen(function* () {
			const compiled = yield* compileFixture(`
import { defineManifest, defineWorkflow, Effect, Schema } from "@ryot-app/sandbox-sdk/workflow";
export const manifest = defineManifest({ kind: "workflow", name: "Short sleep", slug: "short-sleep" });
export default defineWorkflow({ manifest, input: Schema.Struct({}), output: Schema.String,
  run: (_input, replay) => Effect.gen(function* () {
    yield* replay.sleep("first", 25);
    yield* replay.sleep("second", 25);
    yield* replay.sleep("long", 1001);
    return "done";
  }) });`);
			const waits: number[] = [];
			const inlineDurableHost: SandboxInlineDurableHost = {
				capabilities: [],
				cancel: () => Effect.void,
				settle: (requests, wait, checkpoint) =>
					Effect.gen(function* () {
						for (const request of requests) {
							assert(request.kind === "sleep");
							waits.push(request.args.durationMs);
							if (!(yield* wait.wait(request.args.durationMs))) {
								return null;
							}
							yield* checkpoint({ request, value: null, _tag: "Completed" });
						}
						return requests.map(() => null);
					}),
			};
			const live = yield* runNative(
				compiled,
				{},
				{ inlineDurableHost, workflowExecutionId: "short-sleep-parent" },
			);
			expect(live.response).toMatchObject({
				success: true,
				value: { state: "pending", journalLength: 0 },
			});
			expect(live.inline.map((entry) => entry.request.name)).toEqual(["first", "second"]);
			expect(live.controls).toEqual(["inlineBatch", "inlineBatch", "inlineBatch"]);
			expect(waits).toEqual([25, 25, 1_001]);
			const journal: WorkflowReplayJournalEntry[] = [
				...live.inline,
				{
					value: null,
					request: { index: 2, name: "long", kind: "sleep", args: { durationMs: 1_001 } },
				},
			];
			const replay = yield* runNative(
				compiled,
				{},
				{ inlineDurableHost, replayJournal: journal, workflowExecutionId: "short-sleep-parent" },
			);
			expect(replay.response).toMatchObject({
				success: true,
				value: { output: "done", journalLength: 3, state: "completed" },
			});
			expect(replay.inline).toEqual([]);
			expect(waits).toEqual([25, 25, 1_001]);
		}),
	);

	test.effect("short_sleep_batch_preserves_partial_settlement_at_budget", () =>
		Effect.gen(function* () {
			const compiled = yield* compileFixture(`
import { defineManifest, defineWorkflow, Effect, Schema } from "@ryot-app/sandbox-sdk/workflow";
export const manifest = defineManifest({ kind: "workflow", name: "Parallel sleeps", slug: "parallel-sleeps" });
export default defineWorkflow({ manifest, input: Schema.Struct({}), output: Schema.Array(Schema.Null),
  run: (_input, replay) => Effect.all([replay.sleep("first", 750), replay.sleep("second", 750)], { concurrency: "unbounded" }) });`);
			const result = yield* runNative(
				compiled,
				{},
				{
					workflowExecutionId: "parallel-sleep-parent",
					inlineDurableHost: {
						capabilities: [],
						cancel: () => Effect.void,
						settle: (requests, wait, checkpoint) =>
							Effect.gen(function* () {
								const settled = yield* Effect.forEach(
									requests,
									(request) =>
										Effect.gen(function* () {
											assert(request.kind === "sleep");
											const complete = yield* wait.wait(request.args.durationMs);
											if (complete) {
												yield* checkpoint({ request, value: null, _tag: "Completed" });
											}
											return complete;
										}),
									{ concurrency: 4 },
								);
								return settled.every(Boolean) ? settled.map(() => null) : null;
							}),
					},
				},
			);
			expect(result.response).toMatchObject({
				success: true,
				value: {
					state: "pending",
					journalLength: 0,
					requests: [
						{ index: 0, name: "first" },
						{ index: 1, name: "second" },
					],
				},
			});
			expect(result.inline).toEqual([]);
			expect(result.pendingInline).toEqual([
				{
					value: null,
					_tag: "Completed",
					request: { index: 0, kind: "sleep", name: "first", args: { durationMs: 750 } },
				},
			]);
			expect(result.controls).toEqual(["inlineBatch"]);
		}),
	);

	test.effect("short_wait_settlement_freezes_isolate_fibers_and_timers", () =>
		Effect.gen(function* () {
			const compiled = yield* compileFixture(`
import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";
import { defineOperation } from "@ryot-app/sandbox-sdk/operation";
export const manifest = defineManifest({ kind: "operation", name: "Native runner", slug: "native-runner" });
export default defineOperation({
  manifest,
  input: Schema.Struct({}),
  output: Schema.Unknown,
  run: (_input, host) => Effect.gen(function* () {
    const ran: string[] = [];
    queueMicrotask(() => ran.push("microtask"));
    setTimeout(() => ran.push("timer"), 0);
    yield* Effect.forkChild(Effect.sleep("1 millis").pipe(Effect.tap(() => Effect.sync(() => ran.push("fiber")))));
    const value = yield* host.getCachedValue("frozen");
    return { value, ran: [...ran] };
  }),
});`);
			const result = yield* runNative(
				compiled,
				{},
				{
					lane: "background",
					workflowExecutionId: "short-wait-freeze-test",
					inlineDurableHost: {
						cancel: () => Effect.void,
						capabilities: ["getCachedValue"],
						settle: (requests, wait) =>
							Effect.gen(function* () {
								yield* wait.wait(100);
								return requests.map(() => ({ value: "settled", state: "success" as const }));
							}),
					},
				},
			);
			expect(result.response).toMatchObject({
				success: true,
				value: { state: "completed", output: { ran: [], value: "settled" } },
			});
			expect(result.inline).toHaveLength(1);
			expect(result.inline[0]).toMatchObject({
				value: { value: "settled", state: "success" },
				request: {
					index: 0,
					kind: "host",
					name: "getCachedValue",
					args: { args: ["frozen"], capability: "getCachedValue" },
				},
			});
			expect(result.controls).toEqual(["inlineBatch"]);
		}),
	);
});
