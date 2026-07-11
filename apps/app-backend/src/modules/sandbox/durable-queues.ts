import { Activity, DurableQueue } from "@effect/workflow";
import { SandboxRunError, unknownToMessage } from "@ryot/contract/errors";
import {
	SandboxCompletedResult,
	SandboxExecutionPayload,
} from "@ryot/contract/modules/sandbox/schemas";
import { Effect, Layer } from "effect";

import { AppConfig } from "#lib/infrastructure/config/service";
import { DbRunner } from "#lib/infrastructure/db/service";
import { SandboxService as RuntimeSandboxService } from "#lib/infrastructure/sandbox-runtime/service";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";

import { SandboxRepository } from "./repository";

export const SandboxExecutionQueue = DurableQueue.make({
	error: SandboxRunError,
	name: "SandboxExecutionQueue",
	success: SandboxCompletedResult,
	payload: SandboxExecutionPayload,
	idempotencyKey: ({ executionId }) => executionId,
});

export const resolveSandboxExecutionPayload = Effect.fn("resolveSandboxExecutionPayload")(
	function* (payload: SandboxExecutionPayload) {
		const runWithDb = yield* DbRunner;
		const repository = yield* SandboxRepository;
		const pluginRuntime = yield* PluginRuntimeResolver;
		const pluginOwned = yield* runWithDb(repository.isPluginScript(payload.scriptId));
		if (!pluginOwned) {
			return payload;
		}

		const activeScript = yield* runWithDb(pluginRuntime.findActiveScriptById(payload.scriptId));
		if (!activeScript) {
			return yield* new SandboxRunError({ message: "Sandbox script not found" });
		}
		return { ...payload, scriptId: activeScript.id };
	},
);

export const makeSandboxExecutionResolutionActivity = (payload: SandboxExecutionPayload) =>
	Activity.make({
		error: SandboxRunError,
		success: SandboxExecutionPayload,
		name: `resolve-sandbox-execution-${payload.executionId}`,
		execute: resolveSandboxExecutionPayload(payload).pipe(
			Effect.mapError((error) => new SandboxRunError({ message: unknownToMessage(error) })),
		),
	});

export const processSandboxExecution = (payload: SandboxExecutionPayload) =>
	makeSandboxExecutionResolutionActivity(payload).pipe(
		Effect.flatMap((resolved) => DurableQueue.process(SandboxExecutionQueue, resolved)),
		Effect.mapError((error) => new SandboxRunError({ message: unknownToMessage(error) })),
	);

export const executeSandboxExecution = Effect.fn("executeSandboxExecution")(function* (
	payload: SandboxExecutionPayload,
) {
	yield* Effect.annotateCurrentSpan({
		userId: payload.userId,
		scriptId: payload.scriptId,
		executionId: payload.executionId,
	});
	const runWithDb = yield* DbRunner;
	const repository = yield* SandboxRepository;
	const sandbox = yield* RuntimeSandboxService;

	const script = yield* runWithDb(repository.getScript(payload.scriptId));
	if (!script) {
		return yield* new SandboxRunError({ message: "Sandbox script not found" });
	}

	const result = yield* sandbox.run({
		scriptId: script.id,
		userId: payload.userId,
		context: payload.context,
		metadata: script.metadata,
		driverName: payload.driverName,
		executionId: payload.executionId,
		scriptIsBuiltin: script.isBuiltin,
		compiledCode: script.compiledCode,
		compiledFormat: script.compiledFormat,
		allowedHostFunctions: script.metadata.capabilities ?? [],
		...(payload.subscriptionRun ? { subscriptionRun: payload.subscriptionRun } : {}),
	});

	return {
		logs: result.logs,
		error: result.error,
		value: result.value,
		timing: result.timing,
		status: "completed" as const,
	};
});

const makeSandboxExecutionQueueWorkerLive = (concurrency: number) =>
	DurableQueue.worker(
		SandboxExecutionQueue,
		(payload) =>
			executeSandboxExecution(payload).pipe(
				Effect.mapError((error) => new SandboxRunError({ message: unknownToMessage(error) })),
			),
		{ concurrency },
	);

export const SandboxExecutionQueueWorkerLive = Layer.unwrapEffect(
	Effect.map(AppConfig, (config) =>
		makeSandboxExecutionQueueWorkerLive(config.sandbox.workerConcurrency),
	),
);
