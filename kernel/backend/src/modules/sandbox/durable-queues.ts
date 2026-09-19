import { SandboxRunError, unknownToMessage } from "@ryot-app/contract/errors";
import { SandboxExecutionGrants } from "@ryot-app/contract/modules/sandbox/schemas";
import { workflowReplayJournalEntrySchema } from "@ryot-app/sandbox-sdk/workflow";
import { Effect, Layer, Schema } from "effect";
import { DurableQueue } from "effect/unstable/workflow";

import { AppConfig } from "#lib/infrastructure/config/service";
import { SandboxExecutionPrincipal } from "#lib/infrastructure/sandbox-runtime/execution-principal";
import { SandboxService as RuntimeSandboxService } from "#lib/infrastructure/sandbox-runtime/service";

import {
	SandboxDurableHostDispatcher,
	sandboxInlineDurableCapabilities,
} from "./durable-host-dispatcher";
import { SandboxExecutionResult } from "./execution-result";
import { SandboxRepository } from "./repository";

const SandboxExecutionQueuePayload = Schema.Struct({
	context: Schema.Unknown,
	startedAt: Schema.String,
	/** Entries the workflow has journaled before this replay; inline results must extend it. */
	journalLength: Schema.Int,
	executionId: Schema.String,
	workflowExecutionId: Schema.String,
	principal: SandboxExecutionPrincipal,
	grants: Schema.optional(SandboxExecutionGrants),
});
export type SandboxExecutionQueuePayload = Schema.Schema.Type<typeof SandboxExecutionQueuePayload>;

/** One replay's result, plus the durable host results it settled without ending. */
const SandboxReplayResult = Schema.Struct({
	...SandboxExecutionResult.fields,
	inline: Schema.Array(workflowReplayJournalEntrySchema),
});
export type SandboxReplayResult = Schema.Schema.Type<typeof SandboxReplayResult>;

export const SandboxExecutionQueue = DurableQueue.make({
	error: SandboxRunError,
	success: SandboxReplayResult,
	name: "SandboxExecutionQueue",
	payload: SandboxExecutionQueuePayload,
	idempotencyKey: ({ executionId }) => executionId,
});

export const processSandboxExecutionQueue = (payload: SandboxExecutionQueuePayload) =>
	DurableQueue.process(SandboxExecutionQueue, payload).pipe(
		Effect.mapError(
			(error) => new SandboxRunError({ kind: "infrastructure", message: unknownToMessage(error) }),
		),
	);

export type SandboxExecutionResolutionMode = "active" | "exact";

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
	const dispatcher = yield* SandboxDurableHostDispatcher;

	const script = yield* repository.getScript(payload.principal.scriptId);
	if (!script || script.contentHash !== payload.principal.contentHash) {
		return yield* new SandboxRunError({
			kind: "missing-artifact",
			message: "Sandbox script not found",
		});
	}
	const inlineCapabilities = sandboxInlineDurableCapabilities(payload.principal);

	const result = yield* sandbox.run({
		context: payload.context,
		startedAt: payload.startedAt,
		principal: payload.principal,
		executionId: payload.executionId,
		compiledCode: script.compiledCode,
		compiledFormat: script.compiledFormat,
		workflowExecutionId: payload.workflowExecutionId,
		...(payload.grants ? { grants: payload.grants } : {}),
		...(inlineCapabilities.length > 0
			? {
					inlineDurableHost: {
						capabilities: inlineCapabilities,
						journalLength: payload.journalLength,
						settle: (requests) =>
							dispatcher.settleInline(
								requests,
								payload.context,
								payload.principal,
								payload.workflowExecutionId,
								payload.startedAt,
							),
					},
				}
			: {}),
	});

	return {
		logs: result.logs,
		error: result.error,
		value: result.value,
		timing: result.timing,
		inline: result.inline,
		harvest: result.harvest,
		status: "completed" as const,
	};
});

const makeSandboxExecutionQueueWorkerLive = (concurrency: number) =>
	DurableQueue.worker(
		SandboxExecutionQueue,
		(payload) =>
			executeSandboxExecution(payload).pipe(
				Effect.mapError(
					(error) =>
						new SandboxRunError({ kind: "infrastructure", message: unknownToMessage(error) }),
				),
			),
		{ concurrency },
	);

export const SandboxExecutionQueueWorkerLive = Layer.unwrap(
	Effect.map(AppConfig, (config) =>
		makeSandboxExecutionQueueWorkerLive(config.sandbox.workerConcurrency),
	),
);
