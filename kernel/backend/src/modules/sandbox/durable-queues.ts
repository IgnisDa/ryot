import { SandboxRunError, unknownToMessage } from "@ryot-app/contract/errors";
import {
	SandboxExecutionGrants,
	type SandboxExecutionPayload,
} from "@ryot-app/contract/modules/sandbox/schemas";
import { Clock, DateTime, Effect, Layer, Schedule, Schema } from "effect";
import { DurableQueue } from "effect/unstable/workflow";

import { AppConfig } from "#lib/infrastructure/config/service";
import { SandboxExecutionPrincipal } from "#lib/infrastructure/sandbox-runtime/execution-principal";
import { SandboxService as RuntimeSandboxService } from "#lib/infrastructure/sandbox-runtime/service";

import { SandboxExecutionResult } from "./execution-result";
import { SandboxPluginScriptResolver } from "./plugin-script-resolver";
import { SandboxRepository } from "./repository";

const SandboxExecutionQueuePayload = Schema.Struct({
	context: Schema.Unknown,
	executionId: Schema.String,
	principal: SandboxExecutionPrincipal,
	startedAt: Schema.optional(Schema.String),
	grants: Schema.optional(SandboxExecutionGrants),
	workflowExecutionId: Schema.optional(Schema.String),
});
export type SandboxExecutionQueuePayload = Schema.Schema.Type<typeof SandboxExecutionQueuePayload>;

export const SandboxExecutionQueue = DurableQueue.make({
	error: SandboxRunError,
	name: "SandboxExecutionQueue",
	success: SandboxExecutionResult,
	payload: SandboxExecutionQueuePayload,
	idempotencyKey: ({ executionId }) => executionId,
});

const sandboxRetrySchedule = Schedule.max([Schedule.exponential("1 second"), Schedule.recurs(2)]);

export const processSandboxExecutionQueue = (payload: SandboxExecutionQueuePayload) =>
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
		const repository = yield* SandboxRepository;
		const pluginScriptResolver = yield* SandboxPluginScriptResolver;
		const pluginOwned = yield* repository.isPluginScript(payload.scriptId);
		if (!pluginOwned) {
			return payload;
		}

		const activeScript = yield* pluginScriptResolver.findActiveScriptById(payload.scriptId);
		if (!activeScript) {
			return yield* new SandboxRunError({ message: "Sandbox script not found" });
		}
		return { ...payload, scriptId: activeScript.id };
	},
);

export const executeSandboxExecution = Effect.fn("executeSandboxExecution")(function* (
	payload: SandboxExecutionQueuePayload,
) {
	yield* Effect.annotateCurrentSpan({
		executionId: payload.executionId,
		scriptId: payload.principal.scriptId,
		...("userId" in payload.principal.subject ? { userId: payload.principal.subject.userId } : {}),
	});
	const repository = yield* SandboxRepository;
	const sandbox = yield* RuntimeSandboxService;

	const script = yield* repository.getScript(payload.principal.scriptId);
	if (!script || script.contentHash !== payload.principal.contentHash) {
		return yield* new SandboxRunError({ message: "Sandbox script not found" });
	}
	const workflowExecutionId =
		payload.workflowExecutionId ??
		(payload.principal.metadata.kind === "workflow"
			? /^(.*)-replay-\d+$/.exec(payload.executionId)?.[1]
			: undefined);
	const startedAt =
		payload.startedAt ?? DateTime.formatIso(DateTime.makeUnsafe(yield* Clock.currentTimeMillis));

	const result = yield* sandbox.run({
		startedAt,
		context: payload.context,
		principal: payload.principal,
		executionId: payload.executionId,
		compiledCode: script.compiledCode,
		compiledFormat: script.compiledFormat,
		...(payload.grants ? { grants: payload.grants } : {}),
		...(workflowExecutionId ? { workflowExecutionId } : {}),
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

export const SandboxExecutionQueueWorkerLive = Layer.unwrap(
	Effect.map(AppConfig, (config) =>
		makeSandboxExecutionQueueWorkerLive(config.sandbox.workerConcurrency),
	),
);
