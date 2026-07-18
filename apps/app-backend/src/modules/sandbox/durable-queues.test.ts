import { expect, it } from "@effect/vitest";
import { SandboxScriptId } from "@ryot/contract/schema/brands";
import { Effect, Layer } from "effect";

import { SandboxService as RuntimeSandboxService } from "#lib/infrastructure/sandbox-runtime/service";
import { dbRunnerLayer } from "#lib/test-utils/effect";

import {
	executeSandboxExecution,
	makeSandboxExecutionResolutionActivity,
	resolveSandboxExecutionPayload,
	SandboxExecutionQueue,
} from "./durable-queues";
import { SandboxPluginScriptResolver } from "./plugin-script-resolver";
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
	const executedHashes: string[] = [];
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
					executedHashes.push(input.contentHash);
					let value = "completed:active-v2";
					if (input.compiledCode === historicalContent) {
						value = input.executionId.endsWith("-replay-0")
							? "pending:pinned-v1"
							: "completed:pinned-v1";
					}
					return {
						value,
						logs: [],
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
				executedHashes.push(input.contentHash);
				executedScriptIds.push(input.scriptId);
				executedProviderIds.push(input.providerId);
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
			scriptId: queuedScriptId,
			executionId: "execution-id",
			authority: { type: "system" },
		});
		yield* executeSandboxExecution({
			context: {},
			scriptId: kernelScriptId,
			authority: { type: "system" },
			executionId: "kernel-execution-id",
		});

		expect(executedCode).toBe("queued-version");
		expect(executedScriptIds).toEqual([queuedScriptId, kernelScriptId]);
		expect(executedProviderIds).toEqual(["provider-id", null]);
		expect(executedHashes).toEqual(["queued-hash", "kernel-hash"]);
		expect(result.value).toBe("queued-result");
	}).pipe(Effect.provide(layer));
});
