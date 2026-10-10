import { assert, expect, layer } from "@effect/vitest";
import { compilePluginSandboxSourceEntries } from "@ryot-app/plugin-backend-compiler/plugins";
import { hostFailure, hostSuccess } from "@ryot-app/plugin-backend-sdk/wire";
import type { WorkflowReplayJournalEntry } from "@ryot-app/plugin-backend-sdk/workflow";
import { Effect, Schema } from "effect";
import { Base64 } from "effect/encoding";

import { SANDBOX_LIMITS } from "../protocol/limits";
import { SandboxInvocationResponseSchema, SandboxInvocationSchema } from "../protocol/messages";
import { SandboxSidecarClient } from "./client";
import { compileTestScript } from "./compile.test-support";
import { encodeJson, decodedHostCallArgs } from "./host-call-args.test-support";
import type { SandboxInlineDurableHost } from "./invocation";
import {
	defineNativeScript,
	runNative,
	runNativeOutcome,
	runnerNativeLayer,
	type RunnerCompiled,
} from "./runner-native.test-support";

const durableSource = defineNativeScript(
	`(input, host, execution) => Effect.gen(function* () {
  if (input.mode === "detached") { host.getCachedValue("detached"); return null; }
  if (input.mode === "parallel") {
    return yield* Effect.all([host.getCachedValue("first"), host.getCachedValue("second")], { concurrency: "unbounded" });
  }
  const first = yield* host.getCachedValue("first").pipe(Effect.catch(() => Effect.succeed("caught-pending")));
  const second = yield* host.getCachedValue("second").pipe(Effect.catch((error) => Effect.succeed({ message: error.message, data: error.data })));
  return { first, second, startedAt: execution.startedAt };
})`,
	{ kind: "operation", input: "Schema.Struct({ mode: Schema.String })" },
);

const cachedRequest = (index: number, key: string) => ({
	index,
	kind: "host" as const,
	name: "getCachedValue",
	args: { args: [key], capability: "getCachedValue" as const },
});

const uncheckedDefinition = (compiled: RunnerCompiled, run: string) => ({
	...compiled,
	javascript: `import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
export default { definitionType: "ryot:sandbox-script", manifest: { kind: "script", name: "Native runner", slug: "native-runner" }, input: Schema.Struct({ value: Schema.Unknown }), output: Schema.Number, run: ${run} };`,
});

const runtimeDefinition = (compiled: RunnerCompiled, run: string, topLevel = "") => ({
	...compiled,
	javascript: `import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
${topLevel}
export default { definitionType: "ryot:sandbox-script", manifest: { kind: "${compiled.manifest.kind}", name: "Native runner", slug: "native-runner" }, input: Schema.Unknown, output: Schema.Unknown, run: ${run} };`,
});

layer(runnerNativeLayer, { excludeTestServices: true })((test) => {
	test.effect(
		"preserves pending, committed replay, and identity failures for an SDK root workflow without selected functions",
		() =>
			Effect.gen(function* () {
				const compiled = yield* compileTestScript(`
import { defineManifest, defineScriptReference, defineWorkflow, defineWorkflowReference, Effect, Schema } from "@ryot-app/plugin-backend-sdk/workflow";
export const manifest = defineManifest({ kind: "workflow", name: "SDK root workflow", slug: "sdk-root-workflow" });
const activity = defineScriptReference({ scriptSlug: "root-activity", input: Schema.Struct({ count: Schema.Number }), output: Schema.Number });
const child = defineWorkflowReference({ workflowSlug: "root-child", input: Schema.Struct({ count: Schema.Number }), output: Schema.Number });
export default defineWorkflow({
  manifest,
  input: Schema.Struct({ count: Schema.Number }),
  output: Schema.Struct({ activity: Schema.Number, child: Schema.Number, startedAt: Schema.String }),
  run: (input, replay, execution) => Effect.gen(function* () {
    const activityValue = yield* replay.activity("load-count", activity, { count: input.count });
    const childValue = yield* replay.child("double-count", child, { count: activityValue });
    yield* replay.sleep("wait-before-complete", 5);
    const startedAt = execution.startedAt;
    if (startedAt === undefined) return yield* Effect.fail("Missing pinned workflow start");
    return { activity: activityValue, child: childValue, startedAt };
  }),
});`);
				const client = yield* SandboxSidecarClient;
				const withoutSelectedFunctions: SandboxSidecarClient["Service"] = {
					connect: (settings) =>
						client.connect(settings).pipe(
							Effect.map((connection) => ({
								...connection,
								send: Effect.fnUntraced(function* (
									frame: Parameters<typeof connection.send>[0],
									released?: () => void,
								) {
									if (frame.type !== "run") {
										return yield* connection.send(frame, released);
									}
									const invocation = yield* Schema.decodeUnknownEffect(SandboxInvocationSchema)(
										frame.input,
									).pipe(Effect.orDie);
									const input = yield* Schema.decodeUnknownEffect(Schema.Json)({
										...invocation,
										apiFunctions: [],
									}).pipe(Effect.orDie);
									return yield* connection.send({ ...frame, input });
								}),
							})),
						),
				};
				const options = { workflowExecutionId: "sdk-root-parent" };
				const run = (journal: ReadonlyArray<WorkflowReplayJournalEntry>, count = 7) =>
					runNative(compiled, { count }, { ...options, replayJournal: journal }).pipe(
						Effect.provideService(SandboxSidecarClient, withoutSelectedFunctions),
					);
				const activityRequest = {
					index: 0,
					name: "load-count",
					kind: "activity" as const,
					args: { input: { count: 7 }, scriptSlug: "root-activity" },
				};
				const childRequest = {
					index: 1,
					name: "double-count",
					kind: "child" as const,
					args: { input: { count: 8 }, workflowSlug: "root-child" },
				};
				const sleepRequest = {
					index: 2,
					kind: "sleep" as const,
					args: { durationMs: 5 },
					name: "wait-before-complete",
				};
				const journal: WorkflowReplayJournalEntry[] = [
					{ value: 8, request: activityRequest },
					{ value: 16, request: childRequest },
					{ value: null, request: sleepRequest },
				];
				for (const prefixLength of [0, 1, 2, 3]) {
					const result = yield* run(journal.slice(0, prefixLength));
					assert(result.response.success);
					expect(result.response.value).toEqual(
						prefixLength === 3
							? {
									journalLength: 3,
									state: "completed",
									requests: [activityRequest, childRequest, sleepRequest],
									output: { child: 16, activity: 8, startedAt: "2026-08-06T00:00:00.000Z" },
								}
							: {
									state: "pending",
									journalLength: prefixLength,
									requests: [activityRequest, childRequest, sleepRequest].slice(
										0,
										prefixLength + 1,
									),
								},
					);
					expect(result.inline).toEqual([]);
					expect(result.controls.filter((name) => name !== "journalRead")).toEqual(
						prefixLength === 2 ? ["inlineBatch"] : [],
					);
					if (prefixLength > 0) {
						expect(result.controls.length).toBeGreaterThan(0);
					}
				}
				for (const request of [
					{ ...activityRequest, name: "different-name" },
					{ ...activityRequest, args: { ...activityRequest.args, scriptSlug: "different-target" } },
					{ ...activityRequest, args: { ...activityRequest.args, input: { count: 9 } } },
				]) {
					const result = yield* run([{ request, value: 8 }]);
					expect(result.response).toMatchObject({
						success: true,
						value: {
							state: "failed",
							journalLength: 1,
							requests: [activityRequest],
							error: expect.stringContaining(
								"Sandbox workflow journal identity mismatch at index 0",
							),
						},
					});
				}
				const changedInput = yield* run(journal, 9);
				expect(changedInput.response).toMatchObject({
					success: true,
					value: {
						state: "failed",
						journalLength: 3,
						error: expect.stringContaining("Sandbox workflow journal identity mismatch at index 0"),
					},
				});
				for (const index of [0, 1]) {
					const invalidOutput = yield* run(
						journal.map((entry, entryIndex) =>
							entryIndex === index
								? { request: entry.request, value: "invalid recorded number" }
								: entry,
						),
					);
					expect(invalidOutput.response).toMatchObject({
						success: true,
						value: {
							state: "failed",
							journalLength: 3,
							error: expect.stringContaining("Expected number"),
							requests: [activityRequest, childRequest].slice(0, index + 1),
						},
					});
				}
			}),
	);

	test.effect(
		"keeps ordinary executions from acquiring the private journal through a selected function name",
		() =>
			Effect.gen(function* () {
				const root = yield* compileTestScript(
					defineNativeScript("() => Effect.succeed(null)", { kind: "workflow" }),
				);
				const unavailable = yield* runNative(root, {});
				expect(unavailable.response).toMatchObject({
					success: false,
					error: {
						phase: "execute",
						message: expect.stringContaining("host.replayJournal is not a function"),
					},
				});
				expect(unavailable.controls).toEqual([]);
			}),
	);

	test.effect("preserves determinism through the workflow guard and dependency wrapper", () =>
		Effect.gen(function* () {
			{
				const compiled = yield* compileTestScript(
					defineNativeScript("() => Effect.succeed(null)", { kind: "operation" }),
				);
				const options = { workflowExecutionId: "deterministic-workflow" };
				for (const [expression, message] of [
					["Date.call(undefined)", "Date()"],
					["Reflect.construct(Date, [])", "new Date()"],
					["Math.random.apply(Math)", "Math.random"],
					["crypto.randomUUID.call(crypto)", "crypto.randomUUID"],
					["crypto.getRandomValues.call(crypto, new Uint8Array(1))", "crypto.getRandomValues"],
					["performance.now.apply(performance)", "performance.now"],
				] as const) {
					const top = runtimeDefinition(
						compiled,
						"() => Effect.succeed(null)",
						`const captured = ${expression};`,
					);
					expect((yield* runNative(top, {}, options)).response).toMatchObject({
						success: false,
						error: { phase: "load", message: expect.stringContaining(message) },
					});
					const body = runtimeDefinition(compiled, `() => Effect.sync(() => ${expression})`);
					expect((yield* runNative(body, {}, options)).response).toMatchObject({
						success: false,
						error: { phase: "execute", message: expect.stringContaining(message) },
					});
				}
				const deterministic = runtimeDefinition(
					compiled,
					`() => Effect.succeed(null).pipe(Effect.map(() => ({
  now: savedNow.call(Date), iso: new savedDate("2024-01-01T00:00:00.000Z").toISOString(),
  parsed: savedDate.parse("2024-01-01T00:00:00.000Z"), utc: savedDate.UTC(2024, 0, 1)
})))`,
					"const savedDate = Date; const savedNow = Date.now;",
				);
				expect((yield* runNative(deterministic, {}, options)).response).toMatchObject({
					success: true,
					value: {
						state: "completed",
						output: {
							now: 0,
							utc: 1_704_067_200_000,
							parsed: 1_704_067_200_000,
							iso: "2024-01-01T00:00:00.000Z",
						},
					},
				});
				const temporal = runtimeDefinition(
					compiled,
					'() => Effect.sync(() => { const temporal = Reflect.get(globalThis, "Temporal"); if (temporal?.Now) return temporal.Now.instant.call(temporal.Now); return "absent"; })',
				);
				const temporalResult = yield* runNative(temporal, {}, options);
				if (temporalResult.response.success) {
					expect(temporalResult.response.value).toMatchObject({
						output: "absent",
						state: "completed",
					});
				} else {
					expect(temporalResult.response.error).toMatchObject({
						phase: "execute",
						message: expect.stringContaining("Temporal.Now"),
					});
				}
			}
			{
				const compiled = yield* compileTestScript(defineNativeScript("() => Effect.succeed(null)"));
				const ordinary = runtimeDefinition(
					compiled,
					"() => Effect.sync(() => ({ id: crypto.randomUUID(), now: Date.now() > 0, random: Math.random() >= 0, monotonic: performance.now() >= 0 }))",
				);
				const first = yield* runNative(ordinary, {});
				const second = yield* runNative(ordinary, {});
				expect(first.response).toMatchObject({
					success: true,
					value: { now: true, random: true, monotonic: true },
				});
				expect(second.response).toMatchObject({
					success: true,
					value: { now: true, random: true, monotonic: true },
				});
				assert(first.response.success && second.response.success);
				expect(first.response.value).not.toEqual(second.response.value);
				const clock = yield* compileTestScript(
					defineNativeScript(
						`() => Effect.gen(function* () {
  const before = yield* Clock.currentTimeMillis;
  const start = yield* Clock.monotonicTimeNanos;
  yield* Effect.sleep("1 millis");
  return { before, after: yield* Clock.currentTimeMillis, elapsed: (yield* Clock.monotonicTimeNanos) > start };
})`,
						{ imports: 'import { Clock } from "@ryot-app/plugin-backend-sdk/effect";' },
					),
				);
				expect((yield* runNative(clock, {})).response).toMatchObject({
					success: true,
					value: { elapsed: true, after: 1_785_974_400_000, before: 1_785_974_400_000 },
				});
			}
			{
				const compiled = yield* compileTestScript(
					defineNativeScript(
						`(_input, host) => createYoutubeMusicClient(host, undefined, {
  retrievePlayer: false, retrieveInnertubeConfig: false,
}).pipe(Effect.map((client) => String(client.session.context.client.visitorData)))`,
						{
							output: "Schema.String",
							imports:
								'import { createYoutubeMusicClient } from "@ryot-app/plugin-backend-sdk/youtubei";',
						},
					),
				);
				const first = yield* runNative(compiled, {}, { workflowExecutionId: "youtubei-replay" });
				const second = yield* runNative(compiled, {}, { workflowExecutionId: "youtubei-replay" });
				const other = yield* runNative(compiled, {}, { workflowExecutionId: "youtubei-other" });
				expect(first.response).toMatchObject({
					success: true,
					value: { state: "completed", output: expect.any(String) },
				});
				expect(second.response).toMatchObject({ success: true, value: { state: "completed" } });
				expect(other.response).toMatchObject({ success: true, value: { state: "completed" } });
				assert(first.response.success && second.response.success && other.response.success);
				expect(second.response.value).toEqual(first.response.value);
				expect(other.response.value).not.toEqual(first.response.value);
			}
		}),
	);

	test.effect("keeps the workflow date guard across approved dependency calls", () =>
		Effect.gen(function* () {
			const compiled = yield* compileTestScript(
				defineNativeScript(
					`(_input, host) => createYoutubeMusicClient(host, undefined, {
  retrievePlayer: false, retrieveInnertubeConfig: false,
}).pipe(Effect.flatMap(() => Effect.sync(() => new Date().toISOString())))`,
					{
						output: "Schema.String",
						imports:
							'import { createYoutubeMusicClient } from "@ryot-app/plugin-backend-sdk/youtubei";',
					},
				),
			);
			const { response } = yield* runNative(
				compiled,
				{},
				{ workflowExecutionId: "youtubei-date-guard" },
			);
			expect(response).toMatchObject({
				success: false,
				error: { phase: "execute", message: expect.stringContaining("new Date()") },
			});
		}),
	);

	test.effect("rejects decoded ranges longer than requested", () =>
		Effect.gen(function* () {
			const artifact = yield* compileTestScript(
				defineNativeScript(
					"() => readArtifactRange(0, 4).pipe(Effect.map((range) => range.bytes.length))",
					{
						imports: 'import { readArtifactRange } from "@ryot-app/plugin-backend-sdk/filesystem";',
					},
				),
			);
			for (const bytes of [4, 5]) {
				const { response } = yield* runNative(
					artifact,
					{},
					{
						filesystem: { artifact: true },
						reply: (frame) =>
							frame.name === "artifactReadRange"
								? {
										status: "success",
										value: { size: 8, offset: 0, data: Base64.encode(new Uint8Array(bytes)) },
									}
								: undefined,
					},
				);
				if (bytes === 4) {
					expect(response).toMatchObject({ value: 4, success: true });
				} else {
					expect(response).toMatchObject({
						success: false,
						error: { message: expect.stringContaining("Sandbox artifact range length is invalid") },
					});
				}
			}

			const journal = yield* compileTestScript(
				defineNativeScript('(input, host) => host.getCachedValue("recorded")', {
					kind: "operation",
				}),
			);
			const recorded = {
				workflowExecutionId: "oversized-journal-range",
				replayJournal: [
					{ request: cachedRequest(0, "recorded"), value: { value: "ok", state: "success" } },
				],
			} as const;
			expect((yield* runNative(journal, {}, recorded)).response).toMatchObject({
				success: true,
				value: { output: "ok", state: "completed" },
			});
			const { response, controls } = yield* runNative(
				journal,
				{},
				{
					...recorded,
					reply: (frame) => {
						if (frame.name !== "journalRead") {
							return undefined;
						}
						const args = Schema.decodeUnknownSync(
							Schema.Struct({ length: Schema.Finite, offset: Schema.Finite }),
						)(decodedHostCallArgs(frame.args));
						return {
							status: "success",
							value: {
								offset: args.offset,
								totalBytes: args.offset + args.length,
								data: Base64.encode(new Uint8Array(args.length + 1)),
							},
						};
					},
				},
			);
			expect(response).toMatchObject({ success: true, value: { state: "failed" } });
			expect(controls).toEqual(["journalRead"]);
		}),
	);

	test.effect("freezes fibers and pauses only script time during inline settlement", () =>
		Effect.gen(function* () {
			const compiled = yield* compileTestScript(
				defineNativeScript(
					`(_input, host) => Effect.gen(function* () {
  const ran: string[] = [];
  queueMicrotask(() => ran.push("microtask"));
  setTimeout(() => ran.push("timer"), 0);
  yield* Effect.forkChild(Effect.sleep("1 millis").pipe(Effect.tap(() => Effect.sync(() => ran.push("fiber")))));
  const value = yield* host.getCachedValue("frozen");
  return { value, ran: [...ran] };
})`,
					{ kind: "operation" },
				),
			);
			let settled = 0;
			const result = yield* runNative(
				compiled,
				{},
				{
					lane: "background",
					workflowExecutionId: "freeze-test",
					inlineDurableHost: {
						cancel: () => Effect.void,
						capabilities: ["getCachedValue"],
						settle: (requests) =>
							Effect.sleep("100 millis").pipe(
								Effect.map(() => {
									settled++;
									return requests.map(() => ({ value: "settled", state: "success" as const }));
								}),
							),
					},
				},
			);
			expect(settled).toBe(1);
			expect(result.response).toMatchObject({
				success: true,
				value: { state: "completed", output: { ran: [], value: "settled" } },
			});
			expect(result.inline).toHaveLength(1);
			expect(result.controls).toEqual(["inlineBatch"]);
		}),
	);

	test.effect("surfaces a mismatched inline sleep reply as the SDK's typed journal mismatch", () =>
		Effect.gen(function* () {
			const compiled = yield* compileTestScript(`
import { defineManifest, defineWorkflow, Effect, Schema } from "@ryot-app/plugin-backend-sdk/workflow";
export const manifest = defineManifest({ kind: "workflow", name: "Inline sleep", slug: "inline-sleep" });
export default defineWorkflow({
  manifest,
  input: Schema.Struct({}),
  output: Schema.Null,
  run: (_input, replay) => Effect.gen(function* () {
    yield* replay.sleep("wait", 5);
    return null;
  }),
});`);
			const { controls, response } = yield* runNative(
				compiled,
				{},
				{
					replayJournal: [],
					workflowExecutionId: "inline-mismatch",
					reply: (frame) =>
						frame.name === "inlineBatch"
							? { status: "success", value: { results: [] } }
							: undefined,
				},
			);
			expect(controls).toEqual(["inlineBatch"]);
			expect(response).toMatchObject({
				success: true,
				value: { state: "failed", error: "Error: Inline sleep results do not match the batch" },
			});
		}),
	);

	test.effect("preserves validation, manifests, and failure phases for definitions", () =>
		Effect.gen(function* () {
			{
				for (const kind of ["script", "operation", "workflow", "automation"] as const) {
					const compiled = yield* compileTestScript(
						defineNativeScript("() => Effect.succeed(42)", { kind }),
					);
					const context =
						kind === "automation"
							? {
									automation: {
										runId: "run-1",
										executionUserId: null,
										triggerId: "trigger-1",
										hookSlug: "signal-hook",
										occurredAt: "2026-08-06T00:00:00.000Z",
										payload: {
											properties: {},
											operation: "emit",
											actorUserId: null,
											category: "signal",
											resource: "signal",
											signalSchemaPluginId: null,
											signalSchemaSlug: "changed",
										},
										causation: {
											depth: 0,
											source: "api",
											parentRunId: null,
											lane: "interactive",
											executionId: "root",
											parentTriggerId: null,
											rootExecutionId: "root",
											initiator: { id: null, kind: "system" },
										},
									},
								}
							: {};
					const { response } = yield* runNative(
						compiled,
						context,
						kind === "workflow" ? { workflowExecutionId: "definition-kind" } : {},
					);
					expect(response, encodeJson(response)).toMatchObject({
						success: true,
						value: kind === "workflow" ? { output: 42, state: "completed" } : 42,
					});
				}
				const provider = yield* compileTestScript(`
import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { defineProvider } from "@ryot-app/plugin-backend-sdk/provider";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
export const manifest = defineManifest({ kind: "provider", name: "Native provider", slug: "native-provider" });
export default defineProvider({ manifest, operation: "search", run: input => Effect.succeed({ items: [{ title: input.query, externalId: "result-1" }] }) });`);
				expect((yield* runNative(provider, { query: "native result" })).response).toMatchObject({
					success: true,
					value: { items: [{ title: "native result", externalId: "result-1" }] },
				});
			}
			{
				const compiled = yield* compileTestScript(
					defineNativeScript("(input) => Effect.succeed(input.value)", {
						output: "Schema.Number",
						input: "Schema.Struct({ value: Schema.Number })",
					}),
				);
				const outputInvalid = uncheckedDefinition(
					compiled,
					"(input) => Effect.succeed(input.value)",
				);
				expect((yield* runNative(compiled, { value: 42 })).response).toMatchObject({
					value: 42,
					success: true,
				});
				expect((yield* runNative(compiled, {})).response).toMatchObject({
					success: false,
					error: { phase: "input" },
				});
				expect((yield* runNative(outputInvalid, { value: "wrong" })).response).toMatchObject({
					success: false,
					error: { phase: "output" },
				});
				for (const [run, message] of [
					["() => Promise.resolve(true)", "Sandbox definition must return an Effect"],
					['() => Effect.fail("expected typed failure")', "expected typed failure"],
					['() => Effect.sync(() => { throw new Error("expected defect"); })', "expected defect"],
				] as const) {
					const failed = uncheckedDefinition(compiled, run);
					expect((yield* runNative(failed, { value: 1 })).response).toMatchObject({
						success: false,
						error: { phase: "execute", message: expect.stringContaining(message) },
					});
				}
				const nonJson = uncheckedDefinition(compiled, "() => Effect.succeed(Infinity)");
				expect((yield* runNative(nonJson, { value: 1 })).response).toMatchObject({
					success: false,
					error: { phase: "output" },
				});
			}
			{
				const compiled = yield* compileTestScript(defineNativeScript("() => Effect.succeed(null)"));
				for (const manifest of [
					{ ...compiled.manifest, slug: "different-slug" },
					{ ...compiled.manifest, name: "Different name" },
					{ ...compiled.manifest, kind: "operation" as const },
				]) {
					const result = yield* runNative({ ...compiled, manifest }, {});
					expect(result.response).toMatchObject({
						success: false,
						error: {
							phase: "load",
							message: "Compiled sandbox manifest does not match persisted metadata",
						},
					});
				}
				const functionModule = { ...compiled, javascript: "export default () => 42;" };
				expect((yield* runNative(functionModule, {})).response).toMatchObject({
					success: false,
					error: { phase: "load" },
				});
				const authoredCapabilities = runtimeDefinition(compiled, "() => Effect.succeed(null)");
				expect(
					(yield* runNative(
						{
							...authoredCapabilities,
							javascript: authoredCapabilities.javascript.replace(
								'kind: "script"',
								'capabilities: [], kind: "script"',
							),
						},
						{},
					)).response,
				).toMatchObject({ success: false, error: { phase: "load" } });
			}
		}),
	);

	test.effect("preserves Effect and RyotQL alias identity", () =>
		Effect.gen(function* () {
			const compiled = yield* compileTestScript(
				defineNativeScript(
					'() => Effect.succeed(Effect === Reflect.get(PluginRuntime, "Effect") && sdkTable === pluginTable)',
					{
						imports: `import * as PluginRuntime from "@ryot-app/plugin-kit/effect";
import { table as sdkTable } from "@ryot-app/plugin-backend-sdk/ryotql";
import { table as pluginTable } from "@ryot-app/plugin-kit/ryotql";`,
					},
				),
			);
			expect((yield* runNative(compiled, {})).response).toMatchObject({
				value: true,
				success: true,
			});
		}),
	);

	test.effect("bounds output and console diagnostics", () =>
		Effect.gen(function* () {
			const compiled = yield* compileTestScript(
				defineNativeScript(
					`(input) => Effect.sync(() => {
  if (input.mode === "output") return "x".repeat(${SANDBOX_LIMITS.execution.resultBytes + 1});
  for (let i = 0; i < ${SANDBOX_LIMITS.logs.entryCount + 10}; i++) console.log(i);
  return null;
})`,
					{ input: "Schema.Struct({ mode: Schema.String })" },
				),
			);
			expect((yield* runNative(compiled, { mode: "output" })).response).toMatchObject({
				success: false,
				error: { phase: "output" },
			});
			const { response } = yield* runNative(compiled, { mode: "logs" });
			expect(response.success).toBe(true);
			expect(response.logs).toContain("[sandbox logs truncated]");
			expect(response.logs.length).toBeLessThanOrEqual(SANDBOX_LIMITS.logs.entryCount + 1);
		}),
	);

	test.effect("preserves authored frames and sanitized diagnostics for compiled defects", () =>
		Effect.gen(function* () {
			const compiled =
				yield* compileTestScript(`import { defineManifest, defineScript } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";

export const manifest = defineManifest({ kind: "script", name: "Authored defect", slug: "authored-defect" });
export default defineScript({
  manifest,
  input: Schema.Struct({}),
  output: Schema.Null,
  run: () => Effect.sync(() => {
    throw new Error("native-runner-execution native-runner-script file:///sandbox/private https://secret.invalid/token data:text/javascript;base64,secret");
  }),
});`);
			const { response } = yield* runNative(compiled, {});
			assert(!response.success);
			expect(response.error).toMatchObject({
				line: 10,
				phase: "execute",
				column: expect.any(Number),
				stack: expect.stringContaining("    at script.ts:10:"),
				message: "[redacted] [redacted] [internal] [external URL] script.ts",
			});
			expect(response.error.column).toBeGreaterThan(0);
			expect(encodeJson(response.error)).not.toContain("native-runner-execution");
			expect(encodeJson(response.error)).not.toContain("native-runner-script");
			expect(encodeJson(response.error)).not.toContain("secret.invalid");
			expect(encodeJson(response.error)).not.toContain("file://");
			expect(encodeJson(response.error)).not.toContain("ryot-module:");
			expect(encodeJson(response.error)).not.toContain("ryot-runtime:");
			expect(encodeJson(response.error)).not.toContain("data:text/javascript");
			expect(encodeJson(response.error)).not.toMatch(/[a-f0-9]{64}/);
		}),
	);

	test.effect(
		"keeps failure diagnostics structured when script code poisons built-in prototypes",
		() =>
			Effect.gen(function* () {
				const poisons = [
					["Array.prototype", '"join"'],
					["Array.prototype", '"push"'],
					["Array.prototype", '"some"'],
					["String.prototype", '"split"'],
					["String.prototype", '"slice"'],
					["String.prototype", '"trim"'],
					["String.prototype", '"replace"'],
					["String.prototype", '"includes"'],
					["String.prototype", '"startsWith"'],
					["RegExp.prototype", '"exec"'],
					["RegExp.prototype", '"test"'],
					["RegExp.prototype", "Symbol.replace"],
					["Object.getPrototypeOf(Uint8Array.prototype)", '"subarray"'],
				] as const;
				for (const [owner, key] of poisons) {
					const compiled = yield* compileTestScript(
						defineNativeScript(
							`() => Effect.sync(() => {
  Reflect.defineProperty(${owner}, ${key}, { value: () => undefined });
  throw new Error("native-runner-execution file:///sandbox/private " + "x".repeat(100000));
})`,
							{ output: "Schema.Null" },
						),
					);
					const { outcome } = yield* runNativeOutcome(compiled, {});
					const evidence = encodeJson(outcome);
					expect(evidence).not.toContain("native-runner-execution");
					expect(evidence).not.toContain("sandbox/private");
					if (outcome.status === "completed") {
						const response = yield* Schema.decodeUnknownEffect(SandboxInvocationResponseSchema)(
							outcome.value,
						);
						assert(!response.success);
						expect(response.error.phase).toBe("execute");
					} else {
						expect(outcome).toMatchObject({ status: "failed", phase: "execution" });
					}
				}
			}),
	);

	test.effect("preserves authored relative frames for multi-file compiled defects", () =>
		Effect.gen(function* () {
			const entry = "backend/scripts/entry.sandbox.ts";
			const outputs = yield* compilePluginSandboxSourceEntries(
				{
					"backend/helpers/failure.ts": `export const failAuthored = (depth = 16): never => {
  if (depth > 0) return failAuthored(depth - 1);
  throw new Error("nested authored defect");
};`,
					[entry]: `import { defineManifest, defineScript } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { failAuthored } from "../helpers/failure";
export const manifest = defineManifest({ kind: "script", name: "Mapped plugin defect", slug: "mapped-plugin-defect" });
export default defineScript({ manifest, input: Schema.Struct({}), output: Schema.Null, run: () => Effect.sync(failAuthored) });`,
				},
				[{ entry, kind: "script" }],
			);
			const output = outputs[0];
			assert(output);
			assert(output.compiled.manifest.kind === "script");
			const { response } = yield* runNative(
				{ ...output.compiled, manifest: output.compiled.manifest },
				{},
			);
			assert(!response.success);
			expect(response.error).toMatchObject({
				line: 3,
				column: 9,
				phase: "execute",
				message: "nested authored defect",
				stack: expect.stringContaining("    at backend/helpers/failure.ts:3:9"),
			});
			expect(response.error.stack?.split("\n").length).toBeGreaterThan(10);
			expect(response.error.stack).not.toContain("ryot-module:");
			expect(response.error.stack).not.toContain("ryot-runtime:");
		}),
	);

	test.effect("preserves requests, failures, children, and detached work in durable replay", () =>
		Effect.gen(function* () {
			{
				const compiled = yield* compileTestScript(durableSource);
				for (const mode of ["caught", "parallel"]) {
					const { inline, response } = yield* runNative(
						compiled,
						{ mode },
						{ replayJournal: [], workflowExecutionId: "durable-parent" },
					);
					expect(response).toMatchObject({
						success: true,
						value: {
							state: "pending",
							journalLength: 0,
							requests:
								mode === "parallel"
									? [cachedRequest(0, "first"), cachedRequest(1, "second")]
									: [cachedRequest(0, "first")],
						},
					});
					expect(inline).toEqual([]);
				}
			}
			{
				const compiled = yield* compileTestScript(durableSource);
				const journal: WorkflowReplayJournalEntry[] = [
					{ request: cachedRequest(0, "first"), value: { state: "success", value: "recorded" } },
					{
						request: cachedRequest(1, "second"),
						value: {
							state: "failure",
							error: {
								message: "Missing config",
								data: { keys: ["apiToken"], code: "missing-required-config" },
							},
						},
					},
				];
				let calls = 0;
				const { response, controls } = yield* runNative(
					compiled,
					{ mode: "replay" },
					{
						replayJournal: journal,
						workflowExecutionId: "durable-parent",
						functions: {
							getCachedValue: () =>
								Effect.sync(() => {
									calls++;
									return hostSuccess(null);
								}),
						},
					},
				);
				expect(response).toMatchObject({
					success: true,
					value: {
						journalLength: 2,
						state: "completed",
						output: {
							first: "recorded",
							startedAt: "2026-08-06T00:00:00.000Z",
							second: {
								message: "Missing config",
								data: { keys: ["apiToken"], code: "missing-required-config" },
							},
						},
					},
				});
				expect(calls).toBe(0);
				expect(controls.length).toBeGreaterThan(0);
				expect(controls.every((name) => name === "journalRead")).toBe(true);
			}
			{
				const compiled = yield* compileTestScript(durableSource);
				const uncaught = yield* compileTestScript(
					defineNativeScript('(_input, host) => host.getCachedValue("first")', {
						kind: "operation",
					}),
				);
				for (const request of [
					cachedRequest(0, "changed"),
					{ ...cachedRequest(0, "first"), name: "setCachedValue" },
				]) {
					const { response } = yield* runNative(
						uncaught,
						{},
						{
							workflowExecutionId: "durable-parent",
							replayJournal: [{ request, value: { value: null, state: "success" } }],
						},
					);
					expect(response).toMatchObject({
						success: true,
						value: { state: "failed", journalLength: 1, requests: [cachedRequest(0, "first")] },
					});
				}
				expect(
					(yield* runNative(
						compiled,
						{ mode: "detached" },
						{ workflowExecutionId: "durable-parent" },
					)).response,
				).toMatchObject({
					success: true,
					value: {
						state: "failed",
						error: "Sandbox body returned with detached or in-flight durable host work",
					},
				});
			}
			{
				const compiled = yield* compileTestScript(
					defineNativeScript("() => Effect.succeed(null)", { kind: "operation" }),
				);
				const target = runtimeDefinition(
					compiled,
					`(_input, host) => host.executeWorkflow("child", { workflowSlug: "child-workflow", input: Schema.Struct({ count: Schema.Number }), output: Schema.Number }, _input)`,
				);
				const invalidInput = yield* runNative(
					target,
					{ count: "wrong" },
					{ workflowExecutionId: "child-parent" },
				);
				expect(invalidInput.response).toMatchObject({
					success: true,
					value: {
						requests: [],
						state: "failed",
						error: expect.stringContaining("executeWorkflow input is invalid"),
					},
				});
				const pending = yield* runNative(
					target,
					{ count: 7 },
					{ workflowExecutionId: "child-parent" },
				);
				const request = {
					index: 0,
					name: "child",
					kind: "workflow-child" as const,
					args: { input: { count: 7 }, workflowSlug: "child-workflow" },
				};
				expect(pending.response).toMatchObject({
					success: true,
					value: { state: "pending", requests: [request] },
				});
				for (const value of [42, "wrong"]) {
					const replay = yield* runNative(
						target,
						{ count: 7 },
						{
							workflowExecutionId: "child-parent",
							replayJournal: [{ request, value: { value, state: "success" } }],
						},
					);
					expect(replay.response).toMatchObject({
						success: true,
						value:
							typeof value === "number"
								? { output: value, journalLength: 1, state: "completed" }
								: {
										state: "failed",
										error: expect.stringContaining("Recorded workflow child output is invalid"),
									},
					});
					expect(replay.controls.every((name) => name === "journalRead")).toBe(true);
				}
				const invalidTarget = runtimeDefinition(
					compiled,
					'(_input, host) => host.executeWorkflow("", {}, {}).pipe(Effect.catch(error => Effect.succeed(error.data)))',
				);
				expect(
					(yield* runNative(invalidTarget, {}, { workflowExecutionId: "child-parent" })).response,
				).toMatchObject({
					success: true,
					value: {
						state: "completed",
						output: { operation: "executeWorkflow", code: "invalid-executable-target" },
					},
				});
				const typedFailure = runtimeDefinition(
					compiled,
					'() => Effect.fail({ message: "expected durable failure" })',
				);
				expect(
					(yield* runNative(typedFailure, {}, { workflowExecutionId: "child-parent" })).response,
				).toMatchObject({
					success: true,
					value: { requests: [], state: "failed", error: "expected durable failure" },
				});
				const defect = runtimeDefinition(
					compiled,
					'() => Effect.sync(() => { throw new Error("durable defect"); })',
				);
				expect(
					(yield* runNative(defect, {}, { workflowExecutionId: "child-parent" })).response,
				).toMatchObject({ success: false, error: { phase: "execute", message: "durable defect" } });
			}
		}),
	);

	test.effect("keeps inline success, failure, and committed replay evidence", () =>
		Effect.gen(function* () {
			const compiled = yield* compileTestScript(durableSource);
			const batches: string[][] = [];
			const inlineDurableHost: SandboxInlineDurableHost = {
				cancel: () => Effect.void,
				capabilities: ["getCachedValue"] as const,
				settle: (requests) =>
					Effect.sync(() => {
						batches.push(requests.map((request) => request.name));
						return requests.map((request) =>
							request.index === 0
								? { value: "inline-first", state: "success" as const }
								: {
										state: "failure" as const,
										error: {
											message: "Missing config",
											data: { keys: ["apiToken"], code: "missing-required-config" },
										},
									},
						);
					}),
			};
			const live = yield* runNative(
				compiled,
				{ mode: "replay" },
				{ inlineDurableHost, lane: "background", workflowExecutionId: "durable-parent" },
			);
			expect(batches).toEqual([["getCachedValue"], ["getCachedValue"]]);
			expect(live.response).toMatchObject({
				success: true,
				value: {
					journalLength: 0,
					state: "completed",
					output: { first: "inline-first", second: { message: "Missing config" } },
				},
			});
			expect(live.inline).toHaveLength(2);
			const replay = yield* runNative(
				compiled,
				{ mode: "replay" },
				{
					inlineDurableHost,
					lane: "background",
					replayJournal: live.inline,
					workflowExecutionId: "durable-parent",
				},
			);
			expect(replay.response).toMatchObject({
				success: true,
				value: { journalLength: 2, state: "completed" },
			});
			expect(replay.inline).toEqual([]);
			expect(batches).toHaveLength(2);
		}),
	);

	test.effect("batches parallel calls and preserves large multibyte inline values", () =>
		Effect.gen(function* () {
			const compiled = yield* compileTestScript(durableSource);
			const value = '日本語\\"'.repeat(40_000);
			const batches: number[][] = [];
			const { inline, response } = yield* runNative(
				compiled,
				{ mode: "parallel" },
				{
					lane: "background",
					workflowExecutionId: "durable-parent",
					inlineDurableHost: {
						cancel: () => Effect.void,
						capabilities: ["getCachedValue"],
						settle: (requests) =>
							Effect.sync(() => {
								batches.push(requests.map((request) => request.index));
								return requests.map(() => ({ value, state: "success" as const }));
							}),
					},
				},
			);
			expect(batches).toEqual([[0, 1]]);
			expect(response).toMatchObject({
				success: true,
				value: { state: "completed", output: [value, value] },
			});
			expect(inline.map((entry) => entry.value)).toEqual([
				{ value, state: "success" },
				{ value, state: "success" },
			]);
		}),
	);

	test.effect("defers whole batches and rejects non-inline capabilities", () =>
		Effect.gen(function* () {
			const compiled = yield* compileTestScript(durableSource);
			let settlements = 0;
			for (const capabilities of [["getCachedValue"], ["setCachedValue"]] as const) {
				const before = settlements;
				const { inline, response } = yield* runNative(
					compiled,
					{ mode: "parallel" },
					{
						lane: "background",
						workflowExecutionId: "durable-parent",
						inlineDurableHost: {
							capabilities,
							cancel: () => Effect.void,
							settle: () =>
								Effect.sync(() => {
									settlements++;
									return null;
								}),
						},
					},
				);
				expect(response).toMatchObject({
					success: true,
					value: {
						state: "pending",
						requests: [cachedRequest(0, "first"), cachedRequest(1, "second")],
					},
				});
				expect(inline).toEqual([]);
				if (capabilities[0] === "setCachedValue") {
					expect(settlements).toBe(before);
				} else {
					expect(settlements).toBeGreaterThan(before);
				}
			}
		}),
	);

	test.effect("reassembles journal entries larger than host frames", () =>
		Effect.gen(function* () {
			const compiled = yield* compileTestScript(
				defineNativeScript(
					'(input, host) => host.getCachedValue("large").pipe(Effect.map((value) => { if (typeof value !== "string") throw new Error("Expected recorded string"); return { length: value.length, first: value.slice(0, 5), last: value.slice(-5) }; }))',
					{ kind: "operation" },
				),
			);
			const value = '日\\"本語'.repeat(900_000);
			expect(new TextEncoder().encode(encodeJson(value)).byteLength).toBeGreaterThan(
				10 * 1024 * 1024,
			);
			const { response, controls } = yield* runNative(
				compiled,
				{},
				{
					workflowExecutionId: "large-journal",
					replayJournal: [
						{ request: cachedRequest(0, "large"), value: { value, state: "success" } },
					],
				},
			);
			expect(response).toMatchObject({
				success: true,
				value: {
					journalLength: 1,
					state: "completed",
					output: { length: value.length, last: value.slice(-5), first: value.slice(0, 5) },
				},
			});
			expect(controls.length).toBeGreaterThan(10);
			expect(controls.every((name) => name === "journalRead")).toBe(true);
		}),
	);

	test.effect("transports selected host results and boundary reasons", () =>
		Effect.gen(function* () {
			const compiled = yield* compileTestScript(
				defineNativeScript(
					'(input, host) => host.getCachedValue("key").pipe(Effect.catch((error) => Effect.succeed({ message: error.message, data: error.data })))',
				),
			);
			const args: unknown[][] = [];
			const success = yield* runNative(
				compiled,
				{},
				{
					functions: {
						getCachedValue: (values) =>
							Effect.sync(() => {
								args.push([...values]);
								return hostSuccess({ answer: 42 });
							}),
					},
				},
			);
			expect(success.response).toMatchObject({ success: true, value: { answer: 42 } });
			expect(args).toEqual([["key"]]);
			const failed = yield* runNative(
				compiled,
				{},
				{
					functions: {
						getCachedValue: () =>
							Effect.succeed(
								hostFailure("Missing config", {
									keys: ["apiToken"],
									code: "missing-required-config",
								}),
							),
					},
				},
			);
			expect(failed.response).toMatchObject({
				success: true,
				value: {
					message: "Missing config",
					data: { keys: ["apiToken"], code: "missing-required-config" },
				},
			});
		}),
	);

	test.effect("charges failed attempts against the total and HTTP budgets", () =>
		Effect.gen(function* () {
			const compiled = yield* compileTestScript(
				defineNativeScript(
					`(input, host) => Effect.gen(function* () {
  let last: unknown = null;
  const limit = input.mode === "http" ? ${SANDBOX_LIMITS.hostCalls.http} : ${SANDBOX_LIMITS.hostCalls.total};
  for (let i = 0; i <= limit; i++) {
    last = yield* (input.mode === "http" ? host.httpCall("GET", "https://example.com/budget") : host.getCachedValue("budget")).pipe(
      Effect.catch(error => Effect.succeed({ message: error.message, data: error.data ?? null }))
    );
  }
  return last;
})`,
					{ input: "Schema.Struct({ mode: Schema.String })" },
				),
			);
			for (const mode of ["total", "http"]) {
				const calls: string[] = [];
				const { response } = yield* runNative(
					compiled,
					{ mode },
					{
						functions: {
							httpCall: () =>
								Effect.sync(() => {
									calls.push("httpCall");
									return hostFailure("expected HTTP failure");
								}),
							getCachedValue: () =>
								Effect.sync(() => {
									calls.push("getCachedValue");
									return hostFailure("expected attempt failure");
								}),
						},
					},
				);
				expect(response).toMatchObject({
					success: true,
					value: {
						data: {
							code: "execution-limit",
							operation: mode === "http" ? "httpCall" : "getCachedValue",
						},
					},
				});
				expect(calls).toHaveLength(
					mode === "http" ? SANDBOX_LIMITS.hostCalls.http : SANDBOX_LIMITS.hostCalls.total,
				);
			}
		}),
	);
});
