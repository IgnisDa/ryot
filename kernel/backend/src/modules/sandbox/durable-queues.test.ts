import { assert, expect, it, layer } from "@effect/vitest";
import { SandboxRunError } from "@ryot-app/contract/errors";
import { SandboxProviderId, SandboxScriptId } from "@ryot-app/contract/schema/brands";
import { emptySandboxExecutionMetadata } from "@ryot-app/contract/testing";
import { utf8ByteLength } from "@ryot-app/sandbox-compiler/limits";
import { sha256Hex } from "@ryot-app/ts-utils/crypto";
import { Context, Effect, Layer, Ref, Schema } from "effect";

import { redisKeys, RedisService } from "#lib/infrastructure/redis";
import { SandboxService as RuntimeSandboxService } from "#lib/infrastructure/sandbox-runtime/service";
import { appendWorkflowJournal } from "#lib/infrastructure/sandbox-runtime/workflow-journal";
import { readPinnedJournal } from "#lib/infrastructure/sandbox-runtime/workflow-journal.test-support";
import { databaseLayer } from "#lib/test-utils/effect";
import { testExecutionId, testRedisServiceLayer } from "#lib/test-utils/redis";
import { stubRuntimeSandboxService } from "#lib/test-utils/sandbox-runtime";

import { SandboxDurableHostDispatcher } from "./durable-host-dispatcher";
import { executeSandboxExecution, SandboxExecutionQueue } from "./durable-queues";
import { KernelWorkflowReferences } from "./kernel-workflow-references";
import { SandboxPluginScriptResolver } from "./plugin-script-resolver";
import { SandboxRepository } from "./repository";
import { SandboxWorkflowPinning } from "./sandbox-script-workflow";
import { SandboxWorkflowReferenceRepository } from "./workflow-reference-repository";

const queuedReplay = {
	journalLength: 0,
	workflowExecutionId: "workflow-id",
	startedAt: "2026-01-01T00:00:00.000Z",
};
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

const dispatcherLayer = Layer.succeed(SandboxDurableHostDispatcher, {
	dispatch: () => Effect.die("durable dispatch is not expected"),
	settleInline: () => Effect.die("inline dispatch is not expected"),
});

const kernelReferencesLayer = Layer.succeed(KernelWorkflowReferences, {
	execute: () => Effect.die("kernel dispatch is not expected"),
	resolveArtifactGrants: (_input, _subject, grants) => Effect.succeed(grants),
});

type RuntimeRunInput = Parameters<RuntimeSandboxService["Service"]["run"]>[0];
type RuntimeRunResult = Effect.Success<ReturnType<RuntimeSandboxService["Service"]["run"]>>;
const recoveryPinHash = sha256Hex("durable-queue-test-recovery-pin");
const recoveryIdentity = (executionId: string) => ({
	executionId,
	instance: "system/core",
	pinHash: recoveryPinHash,
});

class RecordedRuns extends Context.Service<
	RecordedRuns,
	{
		readonly runs: Effect.Effect<ReadonlyArray<RuntimeRunInput>>;
		readonly reserved: Effect.Effect<ReadonlyArray<string>>;
	}
>()("test/RecordedRuns") {}

const runtimeSandboxLayer = (
	respond: (input: RuntimeRunInput) => Effect.Effect<Omit<RuntimeRunResult, "recovery">>,
) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const runs = yield* Ref.make<ReadonlyArray<RuntimeRunInput>>([]);
			const reserved = yield* Ref.make<ReadonlyArray<string>>([]);
			const stub = stubRuntimeSandboxService((input) =>
				Ref.update(runs, (all) => [...all, input]).pipe(
					Effect.andThen(respond(input)),
					Effect.map((result) => ({ ...result, recovery: recoveryIdentity(input.executionId) })),
				),
			);
			const runtime = {
				...stub,
				reserve: (principal: RuntimeRunInput["principal"], lane: RuntimeRunInput["lane"]) =>
					Ref.update(reserved, (all) => [...all, lane]).pipe(
						Effect.andThen(stub.reserve(principal, lane)),
					),
			};
			return Layer.merge(
				Layer.succeed(RuntimeSandboxService, runtime),
				Layer.succeed(RecordedRuns, { runs: Ref.get(runs), reserved: Ref.get(reserved) }),
			);
		}),
	);

type InlineSettlement = { lane: string; context: unknown; startedAt: string; executionId: string };

class RecordedSettlements extends Context.Service<
	RecordedSettlements,
	{ readonly settlements: Effect.Effect<ReadonlyArray<InlineSettlement>> }
>()("test/RecordedSettlements") {}

const settlingDispatcherLayer = Layer.unwrap(
	Effect.gen(function* () {
		const settlements = yield* Ref.make<ReadonlyArray<InlineSettlement>>([]);
		return Layer.merge(
			Layer.succeed(SandboxDurableHostDispatcher, {
				dispatch: () => Effect.die("durable dispatch is not expected"),
				settleInline: (requests, context, _principal, lane, executionId, startedAt) =>
					Ref.update(settlements, (all) => [
						...all,
						{ lane, context, startedAt, executionId },
					]).pipe(Effect.as(requests.map(() => ({ value: "cached", state: "success" as const })))),
			}),
			Layer.succeed(RecordedSettlements, { settlements: Ref.get(settlements) }),
		);
	}),
);

const historicalScriptId = SandboxScriptId.make("historical-script-id");
const activeScriptId = SandboxScriptId.make("active-script-id");
const historicalContent = `
case "$EXECUTION_ID" in
  *-replay-0) printf 'pending:pinned-v1' ;;
  *) printf 'completed:pinned-v1' ;;
esac
`;
const replacementContent = "printf 'completed:active-v2'";
const hotSwapScript = (id: typeof historicalScriptId, compiledCode: string) => ({
	id,
	compiledCode,
	slug: "workflow",
	name: "Workflow",
	providerId: null,
	compiledFormat: 1,
	pluginSlug: "plugin",
	source: compiledCode,
	createdAt: new Date(0),
	updatedAt: new Date(0),
	contentHash: id === historicalScriptId ? "historical-hash" : "active-hash",
	metadata: {
		...emptySandboxExecutionMetadata,
		name: "Workflow",
		slug: "workflow",
		kind: "workflow" as const,
	},
});
const historical = hotSwapScript(historicalScriptId, historicalContent);
const replacement = hotSwapScript(activeScriptId, replacementContent);

class ActiveScript extends Context.Service<
	ActiveScript,
	{ readonly activate: (id: typeof historicalScriptId) => Effect.Effect<void> }
>()("test/ActiveScript") {}

const hotSwapResolverLayer = Layer.unwrap(
	Effect.gen(function* () {
		const active = yield* Ref.make(historicalScriptId);
		return Layer.merge(
			Layer.mock(SandboxPluginScriptResolver)({
				findActiveScriptById: () =>
					Ref.get(active).pipe(
						Effect.map((id) =>
							hotSwapScript(id, id === historicalScriptId ? historicalContent : replacementContent),
						),
					),
			}),
			Layer.succeed(ActiveScript, { activate: (id) => Ref.set(active, id) }),
		);
	}),
);

it("uses the sandbox execution id as the durable queue identity", () => {
	const payload = {
		context: {},
		journalLength: 0,
		executionId: "execution-id",
		lane: "interactive" as const,
		workflowExecutionId: "workflow-id",
		startedAt: "2026-01-01T00:00:00.000Z",
		principal: {
			providerId: null,
			pluginRevision: null,
			scriptSlug: "workflow",
			contentHash: "historical-hash",
			metadata: { runtimeImports: [] },
			subject: { type: "system" as const },
			scriptId: SandboxScriptId.make("historical-script-id"),
		},
	};

	expect(SandboxExecutionQueue.idempotencyKey(payload)).toBe("execution-id");
});

layer(
	SandboxWorkflowPinning.layer.pipe(
		Layer.provideMerge(
			Layer.mergeAll(
				databaseLayer,
				testRedisServiceLayer,
				dispatcherLayer,
				kernelReferencesLayer,
				Layer.mock(SandboxWorkflowReferenceRepository)({}),
				Layer.mock(SandboxRepository)({
					isPluginScript: () => Effect.succeed(true),
					getScript: (scriptId) =>
						Effect.succeed(scriptId === historicalScriptId ? historical : replacement),
				}),
				hotSwapResolverLayer,
				runtimeSandboxLayer((input) => {
					let value = "completed:active-v2";
					if (input.compiledCode === historicalContent) {
						value = input.executionId.endsWith("-replay-0")
							? "pending:pinned-v1"
							: "completed:pinned-v1";
					}
					return Effect.succeed({
						value,
						logs: [],
						inline: [],
						error: null,
						success: true,
						harvest: null,
						executionId: input.executionId,
						timing: { totalMs: 1, executionMs: 1 },
					});
				}),
			),
		),
	),
)((test) => {
	test.effect(
		"executes pinned content across a shell pending replay after an active hot swap",
		() => {
			const payload = {
				context: {},
				executionId: "execution-id",
				scriptId: historicalScriptId,
				subject: { type: "system" as const },
			};

			return Effect.gen(function* () {
				const pinned = yield* (yield* SandboxWorkflowPinning).resolvePayload(payload, "active");
				const principal = {
					providerId: null,
					pluginRevision: null,
					subject: pinned.subject,
					scriptId: pinned.scriptId,
					scriptSlug: historical.slug,
					metadata: historical.metadata,
					contentHash: historical.contentHash,
				};
				const pending = yield* executeSandboxExecution({
					principal,
					lane: "interactive",
					...queuedReplay,
					context: pinned.context,
					executionId: "execution-id-replay-0",
				});
				expect(pending.value).toBe("pending:pinned-v1");

				yield* (yield* ActiveScript).activate(activeScriptId);
				const replayed = yield* executeSandboxExecution({
					principal,
					lane: "interactive",
					...queuedReplay,
					context: pinned.context,
					executionId: "execution-id-replay-1",
				});
				const runs = yield* (yield* RecordedRuns).runs;
				const executedContent = runs.map((run) => run.compiledCode);
				expect(replayed.value).toBe("completed:pinned-v1");
				expect(executedContent).toEqual([historicalContent, historicalContent]);
				expect(runs.map((run) => run.principal.contentHash)).toEqual([
					"historical-hash",
					"historical-hash",
				]);
				expect(replayed).toMatchObject({ recovery: recoveryIdentity("execution-id-replay-1") });
				expect(executedContent).not.toContain(replacementContent);
			});
		},
	);
});

const queuedScriptId = SandboxScriptId.make("queued-script-id");
const kernelScriptId = SandboxScriptId.make("kernel-script-id");

layer(
	Layer.mergeAll(
		databaseLayer,
		testRedisServiceLayer,
		dispatcherLayer,
		kernelReferencesLayer,
		Layer.mock(SandboxRepository)({
			getScript: (scriptId) =>
				Effect.succeed({
					id: scriptId,
					compiledFormat: 1,
					compiledCode: "queued-version",
					metadata: { runtimeImports: [] },
					providerId: scriptId === queuedScriptId ? "provider-id" : null,
					contentHash: scriptId === queuedScriptId ? "queued-hash" : "kernel-hash",
				}),
		}),
		runtimeSandboxLayer((input) =>
			Effect.succeed({
				logs: [],
				inline: [],
				error: null,
				success: true,
				harvest: null,
				value: "queued-result",
				executionId: input.executionId,
				timing: { totalMs: 1, executionMs: 1 },
			}),
		),
	),
)((test) => {
	test.effect("executes the exact queued row and preserves provider identity", () =>
		Effect.gen(function* () {
			const result = yield* executeSandboxExecution({
				lane: "interactive",
				...queuedReplay,
				context: {},
				executionId: "execution-id",
				principal: {
					scriptSlug: "queued",
					pluginRevision: null,
					scriptId: queuedScriptId,
					contentHash: "queued-hash",
					subject: { type: "system" },
					metadata: { runtimeImports: [] },
					providerId: SandboxProviderId.make("provider-id"),
				},
			});
			yield* executeSandboxExecution({
				lane: "interactive",
				...queuedReplay,
				context: {},
				executionId: "kernel-execution-id",
				principal: {
					providerId: null,
					scriptSlug: "kernel",
					pluginRevision: null,
					scriptId: kernelScriptId,
					contentHash: "kernel-hash",
					subject: { type: "system" },
					metadata: { runtimeImports: [] },
				},
			});
			const runs = yield* (yield* RecordedRuns).runs;

			expect(runs.at(-1)?.compiledCode).toBe("queued-version");
			expect(runs.map((run) => run.principal.scriptId)).toEqual([queuedScriptId, kernelScriptId]);
			expect(runs.map((run) => run.principal.providerId)).toEqual(["provider-id", null]);
			expect(runs.map((run) => run.principal.contentHash)).toEqual(["queued-hash", "kernel-hash"]);
			expect(result.value).toBe("queued-result");
		}),
	);
});

const inlineScriptId = SandboxScriptId.make("inline-script-id");
const inlinePrincipal = (capabilities: ReadonlyArray<string>) => ({
	providerId: null,
	pluginRevision: null,
	scriptSlug: "inline",
	scriptId: inlineScriptId,
	contentHash: "inline-hash",
	subject: { type: "system" as const },
	metadata: { runtimeImports: [], capabilities: [...capabilities] },
});
const inlineWorkflowId = testExecutionId("workflow-id");
const inlineRequest = {
	index: 3,
	kind: "host" as const,
	name: "getCachedValue",
	args: { args: ["key"], capability: "getCachedValue" as const },
};

layer(
	Layer.mergeAll(
		databaseLayer,
		testRedisServiceLayer,
		settlingDispatcherLayer,
		kernelReferencesLayer,
		Layer.mock(SandboxRepository)({
			getScript: () =>
				Effect.succeed({
					providerId: null,
					compiledFormat: 1,
					id: inlineScriptId,
					compiledCode: "code",
					contentHash: "inline-hash",
					metadata: { runtimeImports: [] },
				}),
		}),
		runtimeSandboxLayer((input) =>
			Effect.gen(function* () {
				const inline = input.inlineDurableHost;
				const results = inline ? yield* inline.settle([inlineRequest]) : null;
				return {
					logs: [],
					error: null,
					success: true,
					harvest: null,
					value: results?.length ?? 0,
					executionId: input.executionId,
					timing: { totalMs: 1, executionMs: 1 },
					inline: results
						? [{ request: inlineRequest, value: { value: "cached", state: "success" as const } }]
						: [],
				};
			}),
		),
	),
)((test) => {
	test.effect("durable_replay_pins_inspected_journal_without_loading_values", () =>
		Effect.gen(function* () {
			const workflowExecutionId = testExecutionId("inspected-replay");
			const journal = [{ value: { output: "日本語" }, request: { ...inlineRequest, index: 0 } }];
			yield* appendWorkflowJournal(workflowExecutionId, 0, journal);
			yield* executeSandboxExecution({
				lane: "interactive",
				...queuedReplay,
				context: {},
				journalLength: 1,
				workflowExecutionId,
				principal: inlinePrincipal([]),
				executionId: `${workflowExecutionId}-replay-1`,
			});
			const pinned = (yield* (yield* RecordedRuns).runs).at(-1)?.replayJournal;
			assert(pinned !== undefined);
			expect(pinned.bytes).toBe(utf8ByteLength(encodeJson(journal)));
			expect(yield* readPinnedJournal(pinned)).toEqual(journal);
		}),
	);

	test.effect("offers inline settlement only for declared activity capabilities", () => {
		return Effect.gen(function* () {
			const before = (yield* (yield* RecordedRuns).runs).length;
			const reservedBefore = (yield* (yield* RecordedRuns).reserved).length;
			yield* appendWorkflowJournal(
				inlineWorkflowId,
				0,
				[0, 1, 2].map((index) => ({ value: null, request: { ...inlineRequest, index } })),
			);
			yield* executeSandboxExecution({
				journalLength: 3,
				lane: "background",
				context: { item: 1 },
				workflowExecutionId: inlineWorkflowId,
				startedAt: "2026-01-01T00:00:00.000Z",
				executionId: `${inlineWorkflowId}-replay-2`,
				principal: inlinePrincipal(["createEvents", "getCachedValue", "log"]),
			});
			yield* executeSandboxExecution({
				context: {},
				journalLength: 0,
				lane: "interactive",
				workflowExecutionId: "other-id",
				executionId: "other-id-replay-0",
				startedAt: "2026-01-01T00:00:00.000Z",
				principal: inlinePrincipal(["createEvents", "emitSignal"]),
			});
			const runs = (yield* (yield* RecordedRuns).runs).slice(before);
			const offered = runs.map(({ inlineDurableHost: inline }) =>
				inline ? inline.capabilities : null,
			);

			expect(offered).toEqual([["getCachedValue"], null]);
			expect(runs.map((run) => run.replayJournal?.entries.length)).toEqual([3, 0]);
			expect(runs.map((run) => run.lane)).toEqual(["background", "interactive"]);
			expect((yield* (yield* RecordedRuns).reserved).slice(reservedBefore)).toEqual([
				"background",
				"interactive",
			]);
			expect(yield* (yield* RecordedSettlements).settlements).toEqual([
				{
					lane: "background",
					context: { item: 1 },
					executionId: inlineWorkflowId,
					startedAt: "2026-01-01T00:00:00.000Z",
				},
			]);
		});
	});

	test.effect("durable_replay_reports_projection_faults_over_the_script_outcome", () =>
		Effect.gen(function* () {
			const redis = yield* RedisService;
			const replay = Effect.fnUntraced(function* (
				label: string,
				fault: (key: string) => Promise<unknown>,
			) {
				const workflowExecutionId = testExecutionId(label);
				const key = redisKeys.sandboxWorkflowJournal(workflowExecutionId);
				yield* appendWorkflowJournal(workflowExecutionId, 0, [
					{ value: "small", request: { ...inlineRequest, index: 0 } },
				]);
				const runtime = stubRuntimeSandboxService((input) =>
					Effect.gen(function* () {
						yield* Effect.promise(() => fault(key));
						expect(
							yield* input.replayJournal?.readChunk(0, 0) ?? Effect.die("unpinned"),
						).toBeNull();
						return {
							logs: [],
							inline: [],
							error: null,
							success: true,
							harvest: null,
							executionId: input.executionId,
							value: "script caught the failed read",
							timing: { totalMs: 1, executionMs: 1 },
							recovery: recoveryIdentity(input.executionId),
						};
					}),
				);
				return yield* executeSandboxExecution({
					lane: "interactive",
					...queuedReplay,
					context: {},
					journalLength: 1,
					workflowExecutionId,
					principal: inlinePrincipal([]),
					executionId: `${workflowExecutionId}-replay-1`,
				}).pipe(Effect.provideService(RuntimeSandboxService, runtime), Effect.result);
			});

			const changed = yield* replay("projection-changed", (key) =>
				redis.client.hset(key, "c:0:0", "x".repeat(1024)),
			);
			assert(changed._tag === "Failure" && changed.failure instanceof SandboxRunError);
			expect(changed.failure).toMatchObject({
				kind: "infrastructure",
				message: "Sandbox workflow journal changed after inspection",
			});
			const missing = yield* replay("projection-lost", (key) => redis.client.del(key));
			expect(missing).toMatchObject({
				_tag: "Success",
				success: { status: "completed", projectionMissing: true },
			});
		}),
	);
});

layer(
	Layer.mergeAll(
		databaseLayer,
		testRedisServiceLayer,
		dispatcherLayer,
		kernelReferencesLayer,
		Layer.mock(SandboxRepository)({ getScript: () => Effect.die("script must not load") }),
		runtimeSandboxLayer(() => Effect.die("sandbox must not start")),
	),
)((test) => {
	test.effect("reports a lost journal projection without starting the sandbox", () =>
		Effect.gen(function* () {
			const result = yield* executeSandboxExecution({
				lane: "interactive",
				...queuedReplay,
				context: {},
				journalLength: 2,
				principal: inlinePrincipal([]),
				executionId: "workflow-id-replay-1",
			});

			expect(result).toEqual({
				logs: [],
				inline: [],
				error: null,
				value: null,
				status: "completed",
				projectionMissing: true,
			});
			expect(yield* (yield* RecordedRuns).runs).toEqual([]);
		}),
	);
});
