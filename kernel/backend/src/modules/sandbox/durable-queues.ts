import { SandboxRunError, unknownToMessage } from "@ryot-app/contract/errors";
import { SandboxExecutionGrants } from "@ryot-app/contract/modules/sandbox/schemas";
import { workflowReplayJournalEntrySchema } from "@ryot-app/sandbox-sdk/workflow";
import { isObjectRecord } from "@ryot-app/ts-utils/predicates";
import { Effect, Layer, Schema } from "effect";
import { DurableQueue } from "effect/workflow";

import { AppConfig } from "#lib/infrastructure/config/service";
import { RedisService } from "#lib/infrastructure/redis";
import { SandboxExecutionPrincipal } from "#lib/infrastructure/sandbox-runtime/execution-principal";
import { SandboxService as RuntimeSandboxService } from "#lib/infrastructure/sandbox-runtime/service";
import { readWorkflowJournal } from "#lib/infrastructure/sandbox-runtime/workflow-journal";

import {
	SandboxDurableHostDispatcher,
	sandboxInlineDurableCapabilities,
} from "./durable-host-dispatcher";
import { SandboxExecutionResult } from "./execution-result";
import { KernelWorkflowReferences } from "./kernel-workflow-references";
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

/**
 * One replay's result, plus the durable host results it settled without ending. A replay whose
 * journal projection entries were lost never ran the script and sets `projectionMissing`.
 */
const SandboxReplayResult = Schema.Struct({
	...SandboxExecutionResult.fields,
	inline: Schema.Array(workflowReplayJournalEntrySchema),
	projectionMissing: Schema.optional(Schema.Literal(true)),
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

	const replayJournal = yield* readWorkflowJournal(
		yield* RedisService,
		payload.workflowExecutionId,
		payload.journalLength,
	);
	if (replayJournal === null) {
		return {
			logs: [],
			inline: [],
			error: null,
			value: null,
			status: "completed" as const,
			projectionMissing: true as const,
		};
	}

	const script = yield* repository.getScript(payload.principal.scriptId);
	if (!script || script.contentHash !== payload.principal.contentHash) {
		return yield* new SandboxRunError({
			kind: "missing-artifact",
			message: "Sandbox script not found",
		});
	}
	const inlineCapabilities = sandboxInlineDurableCapabilities(payload.principal);
	const grants =
		isObjectRecord(payload.context) &&
		(typeof payload.context["artifactHandle"] === "string" ||
			isObjectRecord(payload.context["ingestionArtifact"]) ||
			isObjectRecord(payload.context["ingestionArtifacts"]))
			? yield* Effect.flatMap(KernelWorkflowReferences, (references) =>
					references.resolveArtifactGrants(
						payload.context,
						payload.principal.subject,
						payload.grants,
					),
				)
			: payload.grants;

	const result = yield* sandbox.run({
		replayJournal,
		context: payload.context,
		startedAt: payload.startedAt,
		principal: payload.principal,
		executionId: payload.executionId,
		compiledCode: script.compiledCode,
		compiledFormat: script.compiledFormat,
		workflowExecutionId: payload.workflowExecutionId,
		...(grants ? { grants } : {}),
		...(inlineCapabilities.length > 0
			? {
					inlineDurableHost: {
						capabilities: inlineCapabilities,
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
