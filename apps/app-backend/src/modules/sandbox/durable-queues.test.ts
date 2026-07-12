import { Command } from "@effect/platform";
import { BunContext } from "@effect/platform-bun";
import { expect, it } from "@effect/vitest";
import { SandboxScriptId } from "@ryot/contract/schema/brands";
import { Effect, Layer } from "effect";

import { SandboxService as RuntimeSandboxService } from "#lib/infrastructure/sandbox-runtime/service";
import { dbRunnerLayer } from "#lib/test-utils/effect";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";

import {
	executeSandboxExecution,
	makeSandboxExecutionResolutionActivity,
	resolveSandboxExecutionPayload,
	SandboxExecutionQueue,
} from "./durable-queues";
import { SandboxRepository } from "./repository";

it("journals plugin resolution without changing the durable queue identity", () => {
	const payload = {
		context: {},
		authority: { type: "system" as const },
		scriptId: SandboxScriptId.make("historical-script-id"),
		executionId: "execution-id",
	};

	expect(makeSandboxExecutionResolutionActivity(payload).name).toBe(
		"resolve-sandbox-execution-execution-id",
	);
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
	const executedContent: string[] = [];
	const payload = {
		context: {},
		executionId: "execution-id",
		scriptId: historicalScriptId,
		authority: { type: "system" as const },
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
		dbRunnerLayer,
		Layer.mock(SandboxRepository)({
			_tag: "SandboxRepository",
			isPluginScript: () => Effect.succeed(true),
			getScript: (scriptId) =>
				Effect.succeed(scriptId === historicalScriptId ? historical : replacement),
		}),
		Layer.mock(PluginRuntimeResolver)({
			_tag: "PluginRuntimeResolver",
			findActiveScriptById: () =>
				Effect.succeed(
					script(
						activeId,
						activeId === historicalScriptId ? historicalContent : replacementContent,
					),
				),
		}),
		Layer.mock(RuntimeSandboxService)({
			_tag: "SandboxService",
			run: (input) => {
				executedContent.push(input.compiledCode);
				return Command.make("/bin/sh", "-c", input.compiledCode).pipe(
					Command.env({ EXECUTION_ID: input.executionId }),
					Command.string,
					Effect.provide(BunContext.layer),
					Effect.orDie,
					Effect.map((output) => ({
						logs: [],
						error: null,
						success: true,
						value: output,
						harvest: null,
						executionId: input.executionId,
						timing: { totalMs: 1, executionMs: 1 },
					})),
				);
			},
		}),
	);

	return Effect.gen(function* () {
		const pinned = yield* resolveSandboxExecutionPayload(payload, "active");
		const pending = yield* executeSandboxExecution({
			...pinned,
			executionId: "execution-id-replay-0",
		});
		expect(pending.value).toBe("pending:pinned-v1");

		activeId = activeScriptId;
		const replayed = yield* executeSandboxExecution({
			...pinned,
			executionId: "execution-id-replay-1",
		});
		expect(replayed.value).toBe("completed:pinned-v1");
		expect(executedContent).toEqual([historicalContent, historicalContent]);
		expect(executedContent).not.toContain(replacementContent);
	}).pipe(Effect.provide(layer));
});

it.effect("executes the exact queued row and distinguishes plugin from kernel scripts", () => {
	const queuedScriptId = SandboxScriptId.make("queued-script-id");
	const kernelScriptId = SandboxScriptId.make("kernel-script-id");
	let executedCode: string | undefined;
	const executedScriptIds: string[] = [];
	const executedProviderIds: Array<string | null> = [];
	const executedCacheNamespaces: string[] = [];
	const executedScriptIsBuiltin: boolean[] = [];
	const repository = Layer.mock(SandboxRepository)({
		_tag: "SandboxRepository",
		isPluginScript: (scriptId) => Effect.succeed(scriptId !== kernelScriptId),
		getScript: (scriptId) =>
			Effect.succeed({
				id: scriptId,
				metadata: {},
				providerId: scriptId === queuedScriptId ? "provider-id" : null,
				compiledFormat: 1,
				compiledCode: "queued-version",
			}),
	});
	const sandbox = Layer.mock(RuntimeSandboxService)({
		_tag: "SandboxService",
		run: (input) =>
			Effect.sync(() => {
				executedCode = input.compiledCode;
				executedScriptIds.push(input.scriptId);
				executedProviderIds.push(input.providerId);
				executedCacheNamespaces.push(input.cacheNamespace);
				executedScriptIsBuiltin.push(input.scriptIsBuiltin);
				return {
					logs: [],
					error: null,
					success: true,
					harvest: null,
					value: "queued-result",
					executionId: input.executionId,
					timing: { totalMs: 1, executionMs: 1 },
				};
			}),
	});
	const layer = Layer.mergeAll(dbRunnerLayer, repository, sandbox);

	return Effect.gen(function* () {
		const result = yield* executeSandboxExecution({
			context: {},
			authority: { type: "system" },
			scriptId: queuedScriptId,
			executionId: "execution-id",
		});
		yield* executeSandboxExecution({
			context: {},
			authority: { type: "system" },
			scriptId: kernelScriptId,
			executionId: "kernel-execution-id",
		});

		expect(executedCode).toBe("queued-version");
		expect(executedScriptIds).toEqual([queuedScriptId, kernelScriptId]);
		expect(executedProviderIds).toEqual(["provider-id", null]);
		expect(executedCacheNamespaces).toEqual(["provider-id", kernelScriptId]);
		expect(executedScriptIsBuiltin).toEqual([false, true]);
		expect(result.value).toBe("queued-result");
	}).pipe(Effect.provide(layer));
});
