import { expect, it } from "@effect/vitest";
import { SandboxScriptId } from "@ryot/contract/schema/brands";
import { Effect, Layer } from "effect";

import { SandboxService as RuntimeSandboxService } from "#lib/infrastructure/sandbox-runtime/service";
import { dbRunnerLayer } from "#lib/test-utils/effect";

import {
	executeSandboxExecution,
	makeSandboxExecutionResolutionActivity,
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
