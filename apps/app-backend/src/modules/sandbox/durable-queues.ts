import { SandboxRunError, unknownToMessage } from "@ryot/contract/errors";
import { SandboxExecutionPayload } from "@ryot/contract/modules/sandbox/schemas";
import { SandboxProviderId } from "@ryot/contract/schema/brands";
import { Clock, DateTime, Effect, Schedule } from "effect";
import { DurableQueue } from "effect/unstable/workflow";

import { DbRunner } from "#lib/infrastructure/db/service";
import { SANDBOX_LIMITS } from "#lib/infrastructure/sandbox-runtime/limits";
import { SandboxService as RuntimeSandboxService } from "#lib/infrastructure/sandbox-runtime/service";

import { SandboxExecutionResult } from "./execution-result";
import { SandboxPluginScriptResolver } from "./plugin-script-resolver";
import { SandboxRepository } from "./repository";

export const SandboxExecutionQueue = DurableQueue.make({
	error: SandboxRunError,
	name: "SandboxExecutionQueue",
	success: SandboxExecutionResult,
	payload: SandboxExecutionPayload,
	idempotencyKey: ({ executionId }) => executionId,
});

const sandboxRetrySchedule = Schedule.max([Schedule.exponential("1 second"), Schedule.recurs(2)]);

export const processSandboxExecutionQueue = (payload: SandboxExecutionPayload) =>
	DurableQueue.process(SandboxExecutionQueue, payload).pipe(
		Effect.timeout("1 minute"),
		Effect.retry(sandboxRetrySchedule),
		Effect.mapError((error) => new SandboxRunError({ message: unknownToMessage(error) })),
	);

export type SandboxExecutionResolutionMode = "active" | "exact";

export const resolveSandboxExecutionPayload = Effect.fn("resolveSandboxExecutionPayload")(
	function* (payload: SandboxExecutionPayload, mode: SandboxExecutionResolutionMode) {
		if (mode === "exact") {
			return payload;
		}
		const runWithDb = yield* DbRunner;
		const repository = yield* SandboxRepository;
		const pluginScriptResolver = yield* SandboxPluginScriptResolver;
		const pluginOwned = yield* runWithDb(repository.isPluginScript(payload.scriptId));
		if (!pluginOwned) {
			return payload;
		}

		const activeScript = yield* runWithDb(
			pluginScriptResolver.findActiveScriptById(payload.scriptId),
		);
		if (!activeScript) {
			return yield* new SandboxRunError({ message: "Sandbox script not found" });
		}
		return { ...payload, scriptId: activeScript.id };
	},
);

export const executeSandboxExecution = Effect.fn("executeSandboxExecution")(function* (
	payload: SandboxExecutionPayload,
) {
	yield* Effect.annotateCurrentSpan({
		scriptId: payload.scriptId,
		executionId: payload.executionId,
		...("userId" in payload.authority ? { userId: payload.authority.userId } : {}),
	});
	const runWithDb = yield* DbRunner;
	const repository = yield* SandboxRepository;
	const sandbox = yield* RuntimeSandboxService;

	const script = yield* runWithDb(repository.getScript(payload.scriptId));
	if (!script) {
		return yield* new SandboxRunError({ message: "Sandbox script not found" });
	}
	const workflowExecutionId =
		payload.workflowExecutionId ??
		(script.metadata.kind === "workflow"
			? /^(.*)-replay-\d+$/.exec(payload.executionId)?.[1]
			: undefined);
	const startedAt =
		payload.startedAt ?? DateTime.formatIso(DateTime.makeUnsafe(yield* Clock.currentTimeMillis));

	const result = yield* sandbox.run({
		scriptId: script.id,
		context: payload.context,
		metadata: script.metadata,
		startedAt,
		authority: payload.authority,
		contentHash: script.contentHash,
		executionId: payload.executionId,
		compiledCode: script.compiledCode,
		compiledFormat: script.compiledFormat,
		...(payload.grants ? { grants: payload.grants } : {}),
		...(workflowExecutionId ? { workflowExecutionId } : {}),
		allowedHostFunctions: script.metadata.capabilities ?? [],
		providerId: script.providerId ? SandboxProviderId.make(script.providerId) : null,
	});

	return {
		logs: result.logs,
		error: result.error,
		value: result.value,
		timing: result.timing,
		harvest: result.harvest,
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

export const SandboxExecutionQueueWorkerLive = makeSandboxExecutionQueueWorkerLive(
	SANDBOX_LIMITS.workerConcurrency,
);
