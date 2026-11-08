import { expect } from "bun:test";

import { SandboxRunError } from "@ryot-app/contract/errors";
import type { ExecutionLane } from "@ryot-app/contract/modules/automations/lifecycle";
import { SandboxProviderId, SandboxScriptId } from "@ryot-app/contract/schema/brands";
import { emptySandboxExecutionMetadata } from "@ryot-app/contract/testing";
import { utf8ByteLength } from "@ryot-app/plugin-backend-compiler/limits";
import { SandboxExecutor } from "@ryot-app/sandbox/host/executor";
import { stubRuntimeSandboxExecutor } from "@ryot-app/sandbox/host/executor.test-support";
import { readPinnedJournal } from "@ryot-app/sandbox/host/pinned-journal.test-support";
import { makeSandboxShortWait } from "@ryot-app/sandbox/host/short-wait";
import { SidecarRecoverySuspended } from "@ryot-app/sandbox/host/supervisor";
import { assert } from "@ryot-app/testing/assert";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { sha256Hex } from "@ryot-app/ts-utils/crypto";
import { layer } from "@voila.dev/effect-bun-test";
import { eq } from "drizzle-orm";
import { Context, Effect, Fiber, Layer, Ref, Schema } from "effect";
import { TestClock } from "effect/testing";

import { appendWorkflowJournal } from "#modules/scripts/replay/journal";
import { DatabaseSession } from "#platform/db/session";
import { sandboxJournalEntry } from "#schema/tables/sandbox-journal";
import { testExecutionId } from "#testing/effect";
import { isolatedDatabaseLayer } from "#testing/isolated-database";

import { SandboxDurableHostDispatcher } from "../host/durable-dispatcher";
import { SandboxPluginScriptResolver } from "../registry/plugin-script-resolver";
import { SandboxRepository } from "../registry/repository";
import { SandboxWorkflowReferenceRepository } from "../registry/workflow-references";
import {
	compiledArtifactsLayer,
	hotSwapScript,
	scriptRepositoryLayer,
	unusedKernelWorkflowReferencesLayer,
} from "./fixtures.test-support";
import {
	executeSandboxExecution,
	HeldInlineBatch,
	SandboxProjectionMissing,
	SandboxRecoverySuspended,
} from "./queues";
import { SandboxWorkflowPinning } from "./workflow";

const queuedReplay = {
	journalLength: 0,
	workflowExecutionId: "workflow-id",
	startedAt: "2026-01-01T00:00:00.000Z",
};
const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));
const journalEntries = (executionId: string) => eq(sandboxJournalEntry.executionId, executionId);

const dispatcherLayer = Layer.succeed(SandboxDurableHostDispatcher, {
	dispatch: () => Effect.die("durable dispatch is not expected"),
	settleInline: () => Effect.die("inline dispatch is not expected"),
});

type RuntimeRunInput = Parameters<SandboxExecutor["Service"]["run"]>[0];
type RuntimeRunResult = Effect.Success<ReturnType<SandboxExecutor["Service"]["run"]>>;
const recoveryPinHash = sha256Hex("durable-queue-test-recovery-pin");
const recoveryIdentity = (executionId: string) => ({
	executionId,
	instance: "system/core",
	pinHash: recoveryPinHash,
});

class RecordedRuns extends Context.Service<
	RecordedRuns,
	{
		readonly reserved: Effect.Effect<ReadonlyArray<string>>;
		readonly runs: Effect.Effect<ReadonlyArray<RuntimeRunInput>>;
	}
>()("@ryot-app/kernel-backend/modules/scripts/executions/queues.test/RecordedRuns") {}

const runtimeSandboxLayer = (
	respond: (input: RuntimeRunInput) => Effect.Effect<Omit<RuntimeRunResult, "recovery">>,
) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const runs = yield* Ref.make<ReadonlyArray<RuntimeRunInput>>([]);
			const reserved = yield* Ref.make<ReadonlyArray<string>>([]);
			const stub = stubRuntimeSandboxExecutor((input) =>
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
				Layer.succeed(SandboxExecutor, runtime),
				Layer.succeed(RecordedRuns, { runs: Ref.get(runs), reserved: Ref.get(reserved) }),
			);
		}),
	);

type InlineSettlement = {
	lane: string;
	context: unknown;
	startedAt: string;
	executionId: string;
	held: null | string;
};

class RecordedSettlements extends Context.Service<
	RecordedSettlements,
	{ readonly settlements: Effect.Effect<ReadonlyArray<InlineSettlement>> }
>()("@ryot-app/kernel-backend/modules/scripts/executions/queues.test/RecordedSettlements") {}

const settlingDispatcherLayer = Layer.unwrap(
	Effect.gen(function* () {
		const settlements = yield* Ref.make<ReadonlyArray<InlineSettlement>>([]);
		return Layer.merge(
			Layer.succeed(SandboxDurableHostDispatcher, {
				dispatch: () => Effect.die("durable dispatch is not expected"),
				settleInline: (requests, context, _principal, lane, executionId, startedAt) =>
					Effect.gen(function* () {
						const held = yield* HeldInlineBatch;
						yield* Ref.update(settlements, (all) => [
							...all,
							{ lane, held, context, startedAt, executionId },
						]);
						return requests.map(() => ({ value: "cached", state: "success" as const }));
					}),
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
const hotSwapMetadata = {
	...emptySandboxExecutionMetadata,
	name: "Workflow",
	slug: "workflow",
	kind: "workflow" as const,
};
const historical = hotSwapScript(historicalScriptId, historicalContent, hotSwapMetadata);
const replacement = hotSwapScript(activeScriptId, replacementContent, hotSwapMetadata);
const hotSwapRepositoryLayer = scriptRepositoryLayer(
	(scriptId) => (scriptId === historicalScriptId ? historical : replacement),
	{ isPluginScript: () => Effect.succeed(true) },
);
const hotSwapArtifactsLayer = compiledArtifactsLayer(hotSwapRepositoryLayer);

class ActiveScript extends Context.Service<
	ActiveScript,
	{ readonly activate: (id: typeof historicalScriptId) => Effect.Effect<void> }
>()("@ryot-app/kernel-backend/modules/scripts/executions/queues.test/ActiveScript") {}

const hotSwapResolverLayer = Layer.unwrap(
	Effect.gen(function* () {
		const active = yield* Ref.make(historicalScriptId);
		return Layer.merge(
			Layer.mock(SandboxPluginScriptResolver)({
				findActiveScriptById: () =>
					Ref.get(active).pipe(
						Effect.map((id) => (id === historicalScriptId ? historical : replacement)),
					),
			}),
			Layer.succeed(ActiveScript, { activate: (id) => Ref.set(active, id) }),
		);
	}),
);

layer(
	SandboxWorkflowPinning.layer.pipe(
		Layer.provideMerge(
			Layer.mergeAll(
				isolatedDatabaseLayer("sandbox_queues"),
				dispatcherLayer,
				unusedKernelWorkflowReferencesLayer,
				Layer.mock(SandboxWorkflowReferenceRepository)({}),
				hotSwapArtifactsLayer,
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
						pendingInline: [],
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
					historical.contentHash,
					historical.contentHash,
				]);
				expect(yield* (yield* RecordedRuns).reserved).toEqual(["interactive", "interactive"]);
				expect(replayed).toMatchObject({ recovery: recoveryIdentity("execution-id-replay-1") });
				expect(executedContent).not.toContain(replacementContent);
			});
		},
		testTimeout,
	);
});

const queuedScriptId = SandboxScriptId.make("queued-script-id");
const kernelScriptId = SandboxScriptId.make("kernel-script-id");
const queuedCode = "queued-version";
const kernelCode = "kernel-version";
const queuedContentHash = sha256Hex(queuedCode);
const kernelContentHash = sha256Hex(kernelCode);
const queuedRepositoryLayer = scriptRepositoryLayer((scriptId) => ({
	id: scriptId,
	compiledFormat: 1,
	metadata: { runtimeImports: [] },
	providerId: scriptId === queuedScriptId ? "provider-id" : null,
	compiledCode: scriptId === queuedScriptId ? queuedCode : kernelCode,
	contentHash: scriptId === queuedScriptId ? queuedContentHash : kernelContentHash,
}));
const queuedArtifactsLayer = compiledArtifactsLayer(queuedRepositoryLayer);

const nestedRun = (lane: ExecutionLane, held: ExecutionLane) =>
	executeSandboxExecution({
		lane,
		...queuedReplay,
		context: {},
		executionId: `nested-${lane}-${held}`,
		principal: {
			providerId: null,
			scriptSlug: "kernel",
			pluginRevision: null,
			scriptId: kernelScriptId,
			subject: { type: "system" },
			contentHash: kernelContentHash,
			metadata: { runtimeImports: [] },
		},
	}).pipe(Effect.provideService(HeldInlineBatch, held));

layer(
	Layer.mergeAll(
		isolatedDatabaseLayer("sandbox_queues"),
		dispatcherLayer,
		unusedKernelWorkflowReferencesLayer,
		queuedArtifactsLayer,
		runtimeSandboxLayer((input) =>
			Effect.succeed({
				logs: [],
				inline: [],
				error: null,
				success: true,
				harvest: null,
				pendingInline: [],
				value: "queued-result",
				executionId: input.executionId,
				timing: { totalMs: 1, executionMs: 1 },
			}),
		),
	),
)((test) => {
	test.effect(
		"executes the exact queued row and preserves provider identity",
		() =>
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
						subject: { type: "system" },
						contentHash: queuedContentHash,
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
						subject: { type: "system" },
						contentHash: kernelContentHash,
						metadata: { runtimeImports: [] },
					},
				});
				const runs = yield* (yield* RecordedRuns).runs;

				expect(runs.map((run) => run.compiledCode)).toEqual([queuedCode, kernelCode]);
				expect(runs.map((run) => run.principal.scriptId)).toEqual([queuedScriptId, kernelScriptId]);
				expect(runs.map((run) => run.principal)).toMatchObject([
					{ providerId: "provider-id" },
					{ providerId: null },
				]);
				expect(runs.map((run) => run.principal.contentHash)).toEqual([
					queuedContentHash,
					kernelContentHash,
				]);
				expect(result.value).toBe("queued-result");
			}),
		testTimeout,
	);

	test.effect(
		"runs a script nested in an inline batch on the lane that batch does not hold",
		() =>
			Effect.gen(function* () {
				const recorded = yield* RecordedRuns;
				const before = (yield* recorded.reserved).length;
				yield* nestedRun("interactive", "interactive");
				yield* nestedRun("background", "background");
				yield* nestedRun("background", "interactive");
				expect((yield* recorded.reserved).slice(before)).toEqual([
					"background",
					"interactive",
					"background",
				]);
				expect((yield* recorded.runs).slice(before).map(({ lane }) => lane)).toEqual([
					"background",
					"interactive",
					"background",
				]);
			}),
		testTimeout,
	);
});

const inlineScriptId = SandboxScriptId.make("inline-script-id");
const inlineCode = "code";
const inlineContentHash = sha256Hex(inlineCode);
const inlineRepositoryLayer = scriptRepositoryLayer(() => ({
	providerId: null,
	compiledFormat: 1,
	id: inlineScriptId,
	compiledCode: inlineCode,
	contentHash: inlineContentHash,
	metadata: { runtimeImports: [] },
}));
const inlineArtifactsLayer = compiledArtifactsLayer(inlineRepositoryLayer);
const inlinePrincipal = (capabilities: ReadonlyArray<string>) => ({
	providerId: null,
	pluginRevision: null,
	scriptSlug: "inline",
	scriptId: inlineScriptId,
	contentHash: inlineContentHash,
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
		isolatedDatabaseLayer("sandbox_queues"),
		settlingDispatcherLayer,
		unusedKernelWorkflowReferencesLayer,
		inlineArtifactsLayer,
		runtimeSandboxLayer((input) =>
			Effect.gen(function* () {
				const inline = input.inlineDurableHost;
				const results = inline?.capabilities.includes("getCachedValue")
					? yield* inline.settle([inlineRequest], makeSandboxShortWait(), () => Effect.void)
					: null;
				return {
					logs: [],
					error: null,
					success: true,
					harvest: null,
					pendingInline: [],
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
	test.effect(
		"durable_replay_pins_inspected_journal_without_loading_values",
		() =>
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
				expect(pinned.bytes).toBe(utf8ByteLength(yield* encodeJson(journal)));
				expect(yield* readPinnedJournal(pinned)).toEqual(journal);
			}),
		testTimeout,
	);

	test.effect(
		"offers inline settlement only for declared activity capabilities",
		() => {
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

				expect(offered).toEqual([["getCachedValue"], []]);
				expect(runs.map((run) => run.replayJournal?.entries.length)).toEqual([3, 0]);
				expect(runs.map((run) => run.lane)).toEqual(["background", "interactive"]);
				expect((yield* (yield* RecordedRuns).reserved).slice(reservedBefore)).toEqual([
					"background",
					"interactive",
				]);
				expect(yield* (yield* RecordedSettlements).settlements).toEqual([
					{
						held: "background",
						lane: "background",
						context: { item: 1 },
						executionId: inlineWorkflowId,
						startedAt: "2026-01-01T00:00:00.000Z",
					},
				]);
			});
		},
		testTimeout,
	);

	test.effect(
		"durable_replay_reports_a_suspended_sidecar_recovery_as_a_typed_failure",
		() =>
			Effect.gen(function* () {
				const workflowExecutionId = testExecutionId("recovery-suspended");
				yield* appendWorkflowJournal(workflowExecutionId, 0, []);
				const runtime = stubRuntimeSandboxExecutor(() =>
					Effect.fail(new SidecarRecoverySuspended({ instance: "instance-1" })),
				);
				const exit = yield* executeSandboxExecution({
					lane: "interactive",
					...queuedReplay,
					context: {},
					journalLength: 0,
					workflowExecutionId,
					principal: inlinePrincipal([]),
					executionId: `${workflowExecutionId}-replay-0`,
				}).pipe(Effect.provideService(SandboxExecutor, runtime), Effect.exit);

				assertExitFails(exit, new SandboxRecoverySuspended({ instance: "instance-1" }));
			}),
		testTimeout,
	);

	test.effect(
		"durable_replay_reports_projection_faults_over_the_script_outcome",
		() =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const replay = Effect.fnUntraced(function* (
					label: string,
					fault: (entries: ReturnType<typeof journalEntries>) => Effect.Effect<unknown, unknown>,
				) {
					const workflowExecutionId = testExecutionId(label);
					const entries = journalEntries(workflowExecutionId);
					yield* appendWorkflowJournal(workflowExecutionId, 0, [
						{ value: "small", request: { ...inlineRequest, index: 0 } },
					]);
					const runtime = stubRuntimeSandboxExecutor((input) =>
						Effect.gen(function* () {
							yield* fault(entries).pipe(Effect.orDie);
							expect(
								yield* input.replayJournal?.readChunk(0, 0) ?? Effect.die("unpinned"),
							).toBeNull();
							return {
								logs: [],
								inline: [],
								error: null,
								success: true,
								harvest: null,
								pendingInline: [],
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
					}).pipe(Effect.provideService(SandboxExecutor, runtime), Effect.result);
				});

				const changed = yield* replay("projection-changed", (entries) =>
					session.run((db) => db.update(sandboxJournalEntry).set({ pin: "7:1:0" }).where(entries)),
				);
				assert(changed._tag === "Failure" && changed.failure instanceof SandboxRunError);
				expect(changed.failure).toMatchObject({
					kind: "infrastructure",
					message: "Sandbox workflow journal changed after inspection",
				});
				const missing = yield* replay("projection-lost", (entries) =>
					session.run((db) => db.delete(sandboxJournalEntry).where(entries)),
				);
				assert(missing._tag === "Failure" && missing.failure instanceof SandboxProjectionMissing);
			}),
		testTimeout,
	);
});

layer(
	Layer.mergeAll(
		isolatedDatabaseLayer("sandbox_queues"),
		dispatcherLayer,
		unusedKernelWorkflowReferencesLayer,
		compiledArtifactsLayer(
			Layer.mock(SandboxRepository)({ getScript: () => Effect.die("script must not load") }),
		),
		runtimeSandboxLayer(() => Effect.die("sandbox must not start")),
	),
)((test) => {
	test.effect(
		"reports a lost journal projection without starting the sandbox",
		() =>
			Effect.gen(function* () {
				const result = yield* Effect.exit(
					executeSandboxExecution({
						lane: "interactive",
						...queuedReplay,
						context: {},
						journalLength: 2,
						principal: inlinePrincipal([]),
						executionId: "workflow-id-replay-1",
					}),
				);

				assertExitFails(result, new SandboxProjectionMissing());
				expect(yield* (yield* RecordedRuns).runs).toEqual([]);
			}),
		testTimeout,
	);
});

const fullQueue = new SandboxRunError({
	kind: "resource-unavailable",
	message: "Sandbox ephemeral admission queue is full",
});

const fullQueueSandboxLayer = Layer.unwrap(
	Effect.gen(function* () {
		const rejections = yield* Ref.make(2);
		const stub = stubRuntimeSandboxExecutor((input) =>
			Effect.succeed({
				logs: [],
				inline: [],
				error: null,
				success: true,
				harvest: null,
				pendingInline: [],
				value: "queued-result",
				executionId: input.executionId,
				timing: { totalMs: 1, executionMs: 1 },
				recovery: recoveryIdentity(input.executionId),
			}),
		);
		return Layer.succeed(SandboxExecutor, {
			...stub,
			reserve: (principal, lane) =>
				Ref.getAndUpdate(rejections, (count) => count - 1).pipe(
					Effect.flatMap((count) =>
						count > 0 ? Effect.fail(fullQueue) : stub.reserve(principal, lane),
					),
				),
		});
	}),
);

layer(
	Layer.mergeAll(
		isolatedDatabaseLayer("sandbox_queues"),
		dispatcherLayer,
		unusedKernelWorkflowReferencesLayer,
		queuedArtifactsLayer,
		fullQueueSandboxLayer,
	),
)((test) => {
	test.effect(
		"waits out a full admission queue instead of failing a queued execution",
		() =>
			Effect.gen(function* () {
				const execution = yield* Effect.forkChild(nestedRun("background", "interactive"));
				yield* TestClock.adjust("1 second");
				expect((yield* Fiber.join(execution)).value).toBe("queued-result");
			}),
		testTimeout,
	);
});
