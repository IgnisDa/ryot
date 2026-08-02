import { expect, it } from "@effect/vitest";
import { SandboxProviderId, SandboxScriptId } from "@ryot-app/contract/schema/brands";
import { Effect, Layer } from "effect";

import { SandboxService as RuntimeSandboxService } from "#lib/infrastructure/sandbox-runtime/service";
import { databaseLayer } from "#lib/test-utils/effect";

import { SandboxDurableHostDispatcher } from "./durable-host-dispatcher";
import {
	executeSandboxExecution,
	resolveSandboxExecutionPayload,
	SandboxExecutionQueue,
} from "./durable-queues";
import { SandboxPluginScriptResolver } from "./plugin-script-resolver";
import { SandboxRepository } from "./repository";

const queuedReplay = {
	journalLength: 0,
	workflowExecutionId: "workflow-id",
	startedAt: "2026-01-01T00:00:00.000Z",
};

const dispatcherLayer = Layer.succeed(SandboxDurableHostDispatcher, {
	dispatch: () => Effect.die("durable dispatch is not expected"),
	settleInline: () => Effect.die("inline dispatch is not expected"),
});

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

it.effect("executes pinned content across a shell pending replay after an active hot swap", () => {
	const historicalScriptId = SandboxScriptId.make("historical-script-id");
	const activeScriptId = SandboxScriptId.make("active-script-id");
	const historicalContent = `
case "$EXECUTION_ID" in
  *-replay-0) printf 'pending:pinned-v1' ;;
  *) printf 'completed:pinned-v1' ;;
esac
`;
	const replacementContent = "printf 'completed:active-v2'";
	let activeId = historicalScriptId;
	const executedHashes: string[] = [];
	const executedContent: string[] = [];
	const payload = {
		context: {},
		executionId: "execution-id",
		scriptId: historicalScriptId,
		subject: { type: "system" as const },
	};
	const script = (id: typeof historicalScriptId, compiledCode: string) => ({
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
			requiredPluginConfigKeys: [],
			requiredSystemConfigKeys: [],
		},
	});
	const historical = script(historicalScriptId, historicalContent);
	const replacement = script(activeScriptId, replacementContent);
	const layer = Layer.mergeAll(
		databaseLayer,
		dispatcherLayer,
		Layer.mock(SandboxRepository)({
			isPluginScript: () => Effect.succeed(true),
			getScript: (scriptId) =>
				Effect.succeed(scriptId === historicalScriptId ? historical : replacement),
		}),
		Layer.mock(SandboxPluginScriptResolver)({
			findActiveScriptById: () =>
				Effect.succeed(
					script(
						activeId,
						activeId === historicalScriptId ? historicalContent : replacementContent,
					),
				),
		}),
		Layer.mock(RuntimeSandboxService)({
			run: (input) =>
				Effect.sync(() => {
					executedContent.push(input.compiledCode);
					executedHashes.push(input.principal.contentHash);
					let value = "completed:active-v2";
					if (input.compiledCode === historicalContent) {
						value = input.executionId.endsWith("-replay-0")
							? "pending:pinned-v1"
							: "completed:pinned-v1";
					}
					return {
						value,
						logs: [],
						inline: [],
						error: null,
						success: true,
						harvest: null,
						executionId: input.executionId,
						timing: { totalMs: 1, executionMs: 1 },
					};
				}),
		}),
	);

	return Effect.gen(function* () {
		const pinned = yield* resolveSandboxExecutionPayload(payload, "active");
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

		activeId = activeScriptId;
		const replayed = yield* executeSandboxExecution({
			principal,
			...queuedReplay,
			context: pinned.context,
			executionId: "execution-id-replay-1",
		});
		expect(replayed.value).toBe("completed:pinned-v1");
		expect(executedContent).toEqual([historicalContent, historicalContent]);
		expect(executedHashes).toEqual(["historical-hash", "historical-hash"]);
		expect(executedContent).not.toContain(replacementContent);
	}).pipe(Effect.provide(layer));
});

it.effect("executes the exact queued row and preserves provider identity", () => {
	const queuedScriptId = SandboxScriptId.make("queued-script-id");
	const kernelScriptId = SandboxScriptId.make("kernel-script-id");
	let executedCode: string | undefined;
	const executedScriptIds: string[] = [];
	const executedProviderIds: Array<string | null> = [];
	const executedHashes: string[] = [];
	const repository = Layer.mock(SandboxRepository)({
		getScript: (scriptId) =>
			Effect.succeed({
				id: scriptId,
				metadata: {},
				compiledFormat: 1,
				compiledCode: "queued-version",
				providerId: scriptId === queuedScriptId ? "provider-id" : null,
				contentHash: scriptId === queuedScriptId ? "queued-hash" : "kernel-hash",
			}),
	});
	const sandbox = Layer.mock(RuntimeSandboxService)({
		run: (input) =>
			Effect.sync(() => {
				executedCode = input.compiledCode;
				executedHashes.push(input.principal.contentHash);
				executedScriptIds.push(input.principal.scriptId);
				executedProviderIds.push(input.principal.providerId);
				return {
					logs: [],
					inline: [],
					error: null,
					success: true,
					harvest: null,
					value: "queued-result",
					executionId: input.executionId,
					timing: { totalMs: 1, executionMs: 1 },
				};
			}),
	});
	const layer = Layer.mergeAll(databaseLayer, dispatcherLayer, repository, sandbox);

	return Effect.gen(function* () {
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

		expect(executedCode).toBe("queued-version");
		expect(executedScriptIds).toEqual([queuedScriptId, kernelScriptId]);
		expect(executedProviderIds).toEqual(["provider-id", null]);
		expect(executedHashes).toEqual(["queued-hash", "kernel-hash"]);
		expect(result.value).toBe("queued-result");
	}).pipe(Effect.provide(layer));
});

it.effect("offers inline settlement only for declared activity capabilities", () => {
	const scriptId = SandboxScriptId.make("inline-script-id");
	const settled: Array<{ executionId: string; startedAt: string; context: unknown }> = [];
	const offered: Array<{ capabilities: ReadonlyArray<string>; journalLength: number } | null> = [];
	const request = {
		index: 3,
		kind: "host" as const,
		name: "getCachedValue",
		args: { args: ["key"], capability: "getCachedValue" as const },
	};
	const layer = Layer.mergeAll(
		databaseLayer,
		Layer.succeed(SandboxDurableHostDispatcher, {
			dispatch: () => Effect.die("durable dispatch is not expected"),
			settleInline: (requests, context, _principal, executionId, startedAt) =>
				Effect.sync(() => {
					settled.push({ context, startedAt, executionId });
					return requests.map(() => ({ value: "cached", state: "success" as const }));
				}),
		}),
		Layer.mock(SandboxRepository)({
			getScript: () =>
				Effect.succeed({
					id: scriptId,
					metadata: {},
					providerId: null,
					compiledFormat: 1,
					compiledCode: "code",
					contentHash: "inline-hash",
				}),
		}),
		Layer.mock(RuntimeSandboxService)({
			run: (input) =>
				Effect.gen(function* () {
					const inline = input.inlineDurableHost;
					offered.push(
						inline
							? { capabilities: inline.capabilities, journalLength: inline.journalLength }
							: null,
					);
					const results = inline ? yield* inline.settle([request]) : null;
					return {
						logs: [],
						error: null,
						success: true,
						harvest: null,
						value: results?.length ?? 0,
						executionId: input.executionId,
						timing: { totalMs: 1, executionMs: 1 },
						inline: results ? [{ request, value: { value: "cached", state: "success" } }] : [],
					};
				}),
		}),
	);
	const principal = (capabilities: ReadonlyArray<string>) => ({
		scriptId,
		providerId: null,
		pluginRevision: null,
		scriptSlug: "inline",
		contentHash: "inline-hash",
		subject: { type: "system" as const },
		metadata: { capabilities: [...capabilities] },
	});

	return Effect.gen(function* () {
		yield* executeSandboxExecution({
			journalLength: 3,
			context: { item: 1 },
			workflowExecutionId: "workflow-id",
			executionId: "workflow-id-replay-2",
			startedAt: "2026-01-01T00:00:00.000Z",
			principal: principal(["createEvents", "getCachedValue", "log"]),
		});
		yield* executeSandboxExecution({
			context: {},
			journalLength: 0,
			workflowExecutionId: "other-id",
			executionId: "other-id-replay-0",
			startedAt: "2026-01-01T00:00:00.000Z",
			principal: principal(["createEvents", "emitSignal"]),
		});

		expect(offered).toEqual([{ journalLength: 3, capabilities: ["getCachedValue"] }, null]);
		expect(settled).toEqual([
			{ context: { item: 1 }, executionId: "workflow-id", startedAt: "2026-01-01T00:00:00.000Z" },
		]);
	}).pipe(Effect.provide(layer));
});
