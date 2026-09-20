import { expect, it, layer } from "@effect/vitest";
import { SandboxProviderId, SandboxScriptId } from "@ryot-app/contract/schema/brands";
import { Context, Effect, Layer, Ref } from "effect";

import { SandboxService as RuntimeSandboxService } from "#lib/infrastructure/sandbox-runtime/service";
import { databaseLayer } from "#lib/test-utils/effect";

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

class RecordedRuns extends Context.Service<
	RecordedRuns,
	{ readonly runs: Effect.Effect<ReadonlyArray<RuntimeRunInput>> }
>()("test/RecordedRuns") {}

const runtimeSandboxLayer = (
	respond: (input: RuntimeRunInput) => Effect.Effect<RuntimeRunResult>,
) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const runs = yield* Ref.make<ReadonlyArray<RuntimeRunInput>>([]);
			return Layer.merge(
				Layer.mock(RuntimeSandboxService)({
					run: (input) =>
						Ref.update(runs, (all) => [...all, input]).pipe(Effect.andThen(respond(input))),
				}),
				Layer.succeed(RecordedRuns, { runs: Ref.get(runs) }),
			);
		}),
	);

type InlineSettlement = { executionId: string; startedAt: string; context: unknown };

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
				settleInline: (requests, context, _principal, executionId, startedAt) =>
					Ref.update(settlements, (all) => [...all, { context, startedAt, executionId }]).pipe(
						Effect.as(requests.map(() => ({ value: "cached", state: "success" as const }))),
					),
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
		capabilities: [],
		name: "Workflow",
		slug: "workflow",
		kind: "workflow" as const,
		oauthConnectionFields: [],
		executableDependencies: [],
		requiredPluginConfigKeys: [],
		optionalPluginConfigKeys: [],
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
		workflowExecutionId: "workflow-id",
		startedAt: "2026-01-01T00:00:00.000Z",
		principal: {
			metadata: {},
			providerId: null,
			pluginRevision: null,
			scriptSlug: "workflow",
			contentHash: "historical-hash",
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
					...queuedReplay,
					context: pinned.context,
					executionId: "execution-id-replay-0",
				});
				expect(pending.value).toBe("pending:pinned-v1");

				yield* (yield* ActiveScript).activate(activeScriptId);
				const replayed = yield* executeSandboxExecution({
					principal,
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
		dispatcherLayer,
		kernelReferencesLayer,
		Layer.mock(SandboxRepository)({
			getScript: (scriptId) =>
				Effect.succeed({
					id: scriptId,
					metadata: {},
					compiledFormat: 1,
					compiledCode: "queued-version",
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
				...queuedReplay,
				context: {},
				executionId: "execution-id",
				principal: {
					metadata: {},
					scriptSlug: "queued",
					pluginRevision: null,
					scriptId: queuedScriptId,
					contentHash: "queued-hash",
					subject: { type: "system" },
					providerId: SandboxProviderId.make("provider-id"),
				},
			});
			yield* executeSandboxExecution({
				...queuedReplay,
				context: {},
				executionId: "kernel-execution-id",
				principal: {
					metadata: {},
					providerId: null,
					scriptSlug: "kernel",
					pluginRevision: null,
					scriptId: kernelScriptId,
					contentHash: "kernel-hash",
					subject: { type: "system" },
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
	metadata: { capabilities: [...capabilities] },
});
const inlineRequest = {
	index: 3,
	kind: "host" as const,
	name: "getCachedValue",
	args: { args: ["key"], capability: "getCachedValue" as const },
};

layer(
	Layer.mergeAll(
		databaseLayer,
		settlingDispatcherLayer,
		kernelReferencesLayer,
		Layer.mock(SandboxRepository)({
			getScript: () =>
				Effect.succeed({
					metadata: {},
					providerId: null,
					compiledFormat: 1,
					id: inlineScriptId,
					compiledCode: "code",
					contentHash: "inline-hash",
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
	test.effect("offers inline settlement only for declared activity capabilities", () => {
		return Effect.gen(function* () {
			yield* executeSandboxExecution({
				journalLength: 3,
				context: { item: 1 },
				workflowExecutionId: "workflow-id",
				executionId: "workflow-id-replay-2",
				startedAt: "2026-01-01T00:00:00.000Z",
				principal: inlinePrincipal(["createEvents", "getCachedValue", "log"]),
			});
			yield* executeSandboxExecution({
				context: {},
				journalLength: 0,
				workflowExecutionId: "other-id",
				executionId: "other-id-replay-0",
				startedAt: "2026-01-01T00:00:00.000Z",
				principal: inlinePrincipal(["createEvents", "emitSignal"]),
			});
			const offered = (yield* (yield* RecordedRuns).runs).map(({ inlineDurableHost: inline }) =>
				inline ? { capabilities: inline.capabilities, journalLength: inline.journalLength } : null,
			);

			expect(offered).toEqual([{ journalLength: 3, capabilities: ["getCachedValue"] }, null]);
			expect(yield* (yield* RecordedSettlements).settlements).toEqual([
				{ context: { item: 1 }, executionId: "workflow-id", startedAt: "2026-01-01T00:00:00.000Z" },
			]);
		});
	});
});
