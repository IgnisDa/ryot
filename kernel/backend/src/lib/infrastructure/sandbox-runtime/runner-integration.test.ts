import { assert, expect, layer } from "@effect/vitest";
import { compilePluginSandboxSourceEntries } from "@ryot-app/sandbox-compiler/plugins";
import { hostFailure, hostSuccess } from "@ryot-app/sandbox-sdk/wire";
import type { WorkflowReplayJournalEntry } from "@ryot-app/sandbox-sdk/workflow";
import { Effect, Schema } from "effect";
import { Base64 } from "effect/encoding";

import { SandboxCompiler } from "#modules/sandbox/sandbox-compiler";

import { SANDBOX_LIMITS } from "./limits";
import { runNative, runnerNativeLayer, type RunnerCompiled } from "./runner-native.test-support";
import type { SandboxInlineDurableHost } from "./shared";
import { SandboxSidecarClient } from "./sidecar-client";
import { SandboxInvocationSchema } from "./sidecar-protocol";

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

const definitionEntryPoint = (kind: string | undefined) => {
	if (kind === "operation") {
		return "defineOperation";
	}
	if (kind === "workflow") {
		return "defineWorkflow";
	}
	if (kind === "automation") {
		return "defineAutomation";
	}
	return "defineScript";
};

const definition = (
	run: string,
	options: {
		readonly input?: string;
		readonly output?: string;
		readonly imports?: string;
		readonly topLevel?: string;
		readonly kind?: "script" | "operation" | "workflow" | "provider" | "automation";
	} = {},
) => `
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";
import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
${options.kind === "operation" ? 'import { defineOperation } from "@ryot-app/sandbox-sdk/operation";' : ""}
${options.kind === "workflow" ? 'import { defineWorkflow } from "@ryot-app/sandbox-sdk/workflow";' : ""}
${options.kind === "automation" ? 'import { defineAutomation } from "@ryot-app/sandbox-sdk/automation";' : ""}
${options.imports ?? ""}
export const manifest = defineManifest({
  kind: "${options.kind ?? "script"}", name: "Native runner", slug: "native-runner",
  ${options.kind === "automation" ? 'automationType: "automation", inputProjection: { signal: { properties: ["message"] } },' : ""}
});
${options.topLevel ?? ""}
export default ${definitionEntryPoint(options.kind)}({
  manifest,
  ${options.kind === "automation" ? "" : `input: ${options.input ?? "Schema.Struct({})"}, output: ${options.output ?? "Schema.Unknown"},`}
  run: ${run},
});
`;

const durableSource = definition(
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
	javascript: `import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";
export default { definitionType: "ryot:sandbox-script", manifest: { kind: "script", name: "Native runner", slug: "native-runner" }, input: Schema.Struct({ value: Schema.Unknown }), output: Schema.Number, run: ${run} };`,
});

const runtimeDefinition = (compiled: RunnerCompiled, run: string, topLevel = "") => ({
	...compiled,
	javascript: `import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";
${topLevel}
export default { definitionType: "ryot:sandbox-script", manifest: { kind: "${compiled.manifest.kind}", name: "Native runner", slug: "native-runner" }, input: Schema.Unknown, output: Schema.Unknown, run: ${run} };`,
});

layer(runnerNativeLayer, { excludeTestServices: true })((test) => {
	test.effect(
		"sdk_root_workflow_preserves_pending_committed_replay_and_identity_failures_without_selected_functions",
		() =>
			Effect.gen(function* () {
				const compiled = yield* (yield* SandboxCompiler).compile(`
import { defineManifest, defineScriptReference, defineWorkflow, defineWorkflowReference, Effect, Schema } from "@ryot-app/sandbox-sdk/workflow";
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
								send: Effect.fnUntraced(function* (frame: Parameters<typeof connection.send>[0]) {
									if (frame.type !== "run") {
										return yield* connection.send(frame);
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
					expect(result.controls.every((name) => name === "journalRead")).toBe(true);
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
		"ordinary_execution_cannot_acquire_private_journal_from_a_selected_function_name",
		() =>
			Effect.gen(function* () {
				const compiler = yield* SandboxCompiler;
				const root = yield* compiler.compile(
					definition("() => Effect.succeed(null)", { kind: "workflow" }),
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

	test.effect("workflow_guard_and_dependency_wrapper_preserve_determinism", () =>
		Effect.gen(function* () {
			{
				const compiled = yield* (yield* SandboxCompiler).compile(
					definition("() => Effect.succeed(null)", { kind: "operation" }),
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
				const compiler = yield* SandboxCompiler;
				const compiled = yield* compiler.compile(definition("() => Effect.succeed(null)"));
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
				const clock = yield* compiler.compile(
					definition(
						`() => Effect.gen(function* () {
  const before = yield* Clock.currentTimeMillis;
  const start = yield* Clock.monotonicTimeNanos;
  yield* Effect.sleep("1 millis");
  return { before, after: yield* Clock.currentTimeMillis, elapsed: (yield* Clock.monotonicTimeNanos) > start };
})`,
						{ imports: 'import { Clock } from "@ryot-app/sandbox-sdk/effect";' },
					),
				);
				expect((yield* runNative(clock, {})).response).toMatchObject({
					success: true,
					value: { elapsed: true, after: 1_785_974_400_000, before: 1_785_974_400_000 },
				});
			}
			{
				const compiled = yield* (yield* SandboxCompiler).compile(
					definition(
						`(_input, host) => createYoutubeMusicClient(host, undefined, {
  retrievePlayer: false, retrieveInnertubeConfig: false,
}).pipe(Effect.map((client) => String(client.session.context.client.visitorData)))`,
						{
							output: "Schema.String",
							imports: 'import { createYoutubeMusicClient } from "@ryot-app/sandbox-sdk/youtubei";',
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

	test.effect("workflow_date_guard_survives_approved_dependency_calls", () =>
		Effect.gen(function* () {
			const compiled = yield* (yield* SandboxCompiler).compile(
				definition(
					`(_input, host) => createYoutubeMusicClient(host, undefined, {
  retrievePlayer: false, retrieveInnertubeConfig: false,
}).pipe(Effect.flatMap(() => Effect.sync(() => new Date().toISOString())))`,
					{
						output: "Schema.String",
						imports: 'import { createYoutubeMusicClient } from "@ryot-app/sandbox-sdk/youtubei";',
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

	test.effect("native_runner_rejects_decoded_ranges_longer_than_requested", () =>
		Effect.gen(function* () {
			const artifact = yield* (yield* SandboxCompiler).compile(
				definition(
					"() => readArtifactRange(0, 4).pipe(Effect.map((range) => range.bytes.length))",
					{ imports: 'import { readArtifactRange } from "@ryot-app/sandbox-sdk/filesystem";' },
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

			const journal = yield* (yield* SandboxCompiler).compile(
				definition('(input, host) => host.getCachedValue("recorded")', { kind: "operation" }),
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
						)(frame.args);
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

	test.effect("inline_settlement_freezes_fibers_and_pauses_only_script_time", () =>
		Effect.gen(function* () {
			const compiled = yield* (yield* SandboxCompiler).compile(
				definition(
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
					workflowExecutionId: "freeze-test",
					inlineDurableHost: {
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
		}),
	);

	test.effect("definitions_preserve_validation_manifests_and_failure_phases", () =>
		Effect.gen(function* () {
			{
				const compiler = yield* SandboxCompiler;
				for (const kind of ["script", "operation", "workflow", "automation"] as const) {
					const compiled = yield* compiler.compile(
						definition("() => Effect.succeed(42)", { kind }),
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
				const provider = yield* compiler.compile(`
import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
export const manifest = defineManifest({ kind: "provider", name: "Native provider", slug: "native-provider" });
export default defineProvider({ manifest, operation: "search", run: input => Effect.succeed({ items: [{ title: input.query, externalId: "result-1" }] }) });`);
				expect((yield* runNative(provider, { query: "native result" })).response).toMatchObject({
					success: true,
					value: { items: [{ title: "native result", externalId: "result-1" }] },
				});
			}
			{
				const compiler = yield* SandboxCompiler;
				const compiled = yield* compiler.compile(
					definition("(input) => Effect.succeed(input.value)", {
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
				const compiler = yield* SandboxCompiler;
				const compiled = yield* compiler.compile(definition("() => Effect.succeed(null)"));
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

	test.effect("native_runner_preserves_effect_and_ryotql_alias_identity", () =>
		Effect.gen(function* () {
			const compiler = yield* SandboxCompiler;
			const compiled = yield* compiler.compile(
				definition(
					'() => Effect.succeed(Effect === Reflect.get(PluginRuntime, "Effect") && sdkTable === pluginTable)',
					{
						imports: `import * as PluginRuntime from "@ryot-app/plugin-kit/effect";
import { table as sdkTable } from "@ryot-app/sandbox-sdk/ryotql";
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

	test.effect("native_runner_bounds_output_and_console_diagnostics", () =>
		Effect.gen(function* () {
			const compiler = yield* SandboxCompiler;
			const compiled = yield* compiler.compile(
				definition(
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

	test.effect("compiled_defects_preserve_authored_frames_and_sanitized_diagnostics", () =>
		Effect.gen(function* () {
			const compiler = yield* SandboxCompiler;
			const compiled =
				yield* compiler.compile(`import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";

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

	test.effect("compiled_multi_file_defects_preserve_authored_relative_frames", () =>
		Effect.gen(function* () {
			const entry = "backend/scripts/entry.sandbox.ts";
			const outputs = yield* compilePluginSandboxSourceEntries(
				{
					"backend/helpers/failure.ts": `export const failAuthored = () => {
  const message = "nested authored defect";
  throw new Error(message);
};`,
					[entry]: `import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";
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
			expect(response.error.stack).not.toContain("ryot-module:");
			expect(response.error.stack).not.toContain("ryot-runtime:");
		}),
	);

	test.effect("durable_replay_preserves_requests_failures_children_and_detached_work", () =>
		Effect.gen(function* () {
			{
				const compiled = yield* (yield* SandboxCompiler).compile(durableSource);
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
				const compiled = yield* (yield* SandboxCompiler).compile(durableSource);
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
				const compiled = yield* (yield* SandboxCompiler).compile(durableSource);
				const uncaught = yield* (yield* SandboxCompiler).compile(
					definition('(_input, host) => host.getCachedValue("first")', { kind: "operation" }),
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
				const compiled = yield* (yield* SandboxCompiler).compile(
					definition("() => Effect.succeed(null)", { kind: "operation" }),
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

	test.effect("native_runner_keeps_inline_success_failure_and_committed_replay_evidence", () =>
		Effect.gen(function* () {
			const compiled = yield* (yield* SandboxCompiler).compile(durableSource);
			const batches: string[][] = [];
			const inlineDurableHost: SandboxInlineDurableHost = {
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
				{ inlineDurableHost, workflowExecutionId: "durable-parent" },
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
				{ inlineDurableHost, replayJournal: live.inline, workflowExecutionId: "durable-parent" },
			);
			expect(replay.response).toMatchObject({
				success: true,
				value: { journalLength: 2, state: "completed" },
			});
			expect(replay.inline).toEqual([]);
			expect(batches).toHaveLength(2);
		}),
	);

	test.effect(
		"native_runner_batches_parallel_calls_and_preserves_large_multibyte_inline_values",
		() =>
			Effect.gen(function* () {
				const compiled = yield* (yield* SandboxCompiler).compile(durableSource);
				const value = '日本語\\"'.repeat(40_000);
				const batches: number[][] = [];
				const { inline, response } = yield* runNative(
					compiled,
					{ mode: "parallel" },
					{
						workflowExecutionId: "durable-parent",
						inlineDurableHost: {
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

	test.effect("native_runner_defers_whole_batches_and_rejects_non_inline_capabilities", () =>
		Effect.gen(function* () {
			const compiled = yield* (yield* SandboxCompiler).compile(durableSource);
			let settlements = 0;
			for (const capabilities of [["getCachedValue"], ["setCachedValue"]] as const) {
				const before = settlements;
				const { inline, response } = yield* runNative(
					compiled,
					{ mode: "parallel" },
					{
						workflowExecutionId: "durable-parent",
						inlineDurableHost: {
							capabilities,
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

	test.effect("native_runner_reassembles_journal_entries_larger_than_host_frames", () =>
		Effect.gen(function* () {
			const compiled = yield* (yield* SandboxCompiler).compile(
				definition(
					'(input, host) => host.getCachedValue("large").pipe(Effect.map((value) => { if (typeof value !== "string") throw new Error("Expected recorded string"); return { length: value.length, first: value.slice(0, 5), last: value.slice(-5) }; }))',
					{ kind: "operation" },
				),
			);
			const value = '日\\"本語'.repeat(1_400_000);
			expect(new TextEncoder().encode(encodeJson(value)).byteLength).toBeGreaterThan(
				12 * 1024 * 1024,
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
			expect(controls.length).toBeGreaterThan(12);
			expect(controls.every((name) => name === "journalRead")).toBe(true);
		}),
	);

	test.effect("native_runner_transports_selected_host_results_and_boundary_reasons", () =>
		Effect.gen(function* () {
			const compiled = yield* (yield* SandboxCompiler).compile(
				definition(
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

	test.effect("native_runner_charges_failed_attempts_against_total_and_http_budgets", () =>
		Effect.gen(function* () {
			const compiled = yield* (yield* SandboxCompiler).compile(
				definition(
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
