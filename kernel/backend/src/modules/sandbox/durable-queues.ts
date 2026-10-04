import { SandboxRunError } from "@ryot-app/contract/errors";
import { ExecutionLane } from "@ryot-app/contract/modules/automations/lifecycle";
import { SandboxExecutionGrants } from "@ryot-app/contract/modules/sandbox/schemas";
import { workflowReplayJournalEntrySchema } from "@ryot-app/sandbox-sdk/workflow";
import { isObjectRecord } from "@ryot-app/ts-utils/predicates";
import { Duration, Effect, Layer, Schema } from "effect";
import { DurableQueue } from "effect/workflow";

import { AppConfig } from "#lib/infrastructure/config/service";
import { fairQueueStoreLayer } from "#lib/infrastructure/fair-queue-store";
import { RedisService } from "#lib/infrastructure/redis";
import {
	inspectSandboxJournal,
	pinSandboxJournal,
} from "#lib/infrastructure/sandbox-journal-store";
import { SandboxRecoveryIdentity } from "#lib/infrastructure/sandbox-recovery-store";
import { SandboxExecutionPrincipal } from "#lib/infrastructure/sandbox-runtime/execution-principal";
import { sandboxInlineDurableCapabilities } from "#lib/infrastructure/sandbox-runtime/host-execution-policy";
import { SandboxInlineProgress } from "#lib/infrastructure/sandbox-runtime/inline-progress";
import { SandboxService as RuntimeSandboxService } from "#lib/infrastructure/sandbox-runtime/service";
import { SandboxAdmissionLease } from "#lib/infrastructure/sandbox-runtime/sidecar-admission";
import { SidecarRecoverySuspended } from "#lib/infrastructure/sandbox-runtime/sidecar-supervisor";

import { SandboxCompiledArtifacts } from "./compiled-artifacts";
import { SandboxDurableHostDispatcher } from "./durable-host-dispatcher";
import { SandboxExecutionResult } from "./execution-result";
import { KernelWorkflowReferences } from "./kernel-workflow-references";
import { infrastructureRunError } from "./run-error";
import { sandboxSchedulingKey } from "./scheduling-key";

const SandboxExecutionQueuePayload = Schema.Struct({
	lane: ExecutionLane,
	context: Schema.Unknown,
	startedAt: Schema.String,
	/** Entries the workflow has journaled before this replay; inline results must extend it. */
	journalLength: Schema.Int,
	executionId: Schema.String,
	workflowExecutionId: Schema.String,
	principal: SandboxExecutionPrincipal,
	grants: Schema.optional(SandboxExecutionGrants),
	recoveryAttempt: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
});
export type SandboxExecutionQueuePayload = Schema.Schema.Type<typeof SandboxExecutionQueuePayload>;

const SandboxReplayResult = Schema.Struct({
	recovery: Schema.optional(SandboxRecoveryIdentity),
	...SandboxExecutionResult.fields,
	pendingInline: Schema.Array(SandboxInlineProgress),
	inline: Schema.Array(workflowReplayJournalEntrySchema),
});
export type SandboxReplayResult = Schema.Schema.Type<typeof SandboxReplayResult>;

export class SandboxRecoverySuspended extends Schema.TaggedError<SandboxRecoverySuspended>()(
	"SandboxRecoverySuspended",
	{ instance: Schema.String },
) {}

/** The replay's journal projection entries were lost, so the script never ran. */
export class SandboxProjectionMissing extends Schema.TaggedError<SandboxProjectionMissing>()(
	"SandboxProjectionMissing",
	{},
) {}

export const sandboxRecoveryExecutionId = (executionId: string, attempt: number) =>
	`${executionId}-recovery-${attempt}`;

const toQueueError = (error: unknown) =>
	error instanceof SandboxRunError ||
	error instanceof SandboxRecoverySuspended ||
	error instanceof SandboxProjectionMissing
		? error
		: infrastructureRunError(error);

export const SandboxExecutionQueue = DurableQueue.make({
	success: SandboxReplayResult,
	name: "SandboxExecutionQueue",
	payload: SandboxExecutionQueuePayload,
	error: Schema.Union([SandboxRunError, SandboxRecoverySuspended, SandboxProjectionMissing]),
	idempotencyKey: ({ executionId, recoveryAttempt }) =>
		recoveryAttempt === undefined || recoveryAttempt === 0
			? executionId
			: sandboxRecoveryExecutionId(executionId, recoveryAttempt),
});

export const processSandboxExecutionQueue = Effect.fn("processSandboxExecutionQueue")(function* (
	payload: SandboxExecutionQueuePayload,
) {
	const result = yield* DurableQueue.process(SandboxExecutionQueue, payload).pipe(
		Effect.mapError(toQueueError),
	);
	if (result.recovery !== undefined) {
		const runtime = yield* RuntimeSandboxService;
		yield* runtime.completeRecovery(result.recovery);
	}
	return result;
});

export type SandboxExecutionResolutionMode = "active" | "exact";

export const executeSandboxExecution = Effect.fn("executeSandboxExecution")(function* (
	payload: SandboxExecutionQueuePayload,
) {
	yield* Effect.annotateCurrentSpan({
		executionId: payload.executionId,
		scriptId: payload.principal.scriptId,
		...("userId" in payload.principal.subject ? { userId: payload.principal.subject.userId } : {}),
	});
	const artifacts = yield* SandboxCompiledArtifacts;
	const sandbox = yield* RuntimeSandboxService;
	const dispatcher = yield* SandboxDurableHostDispatcher;
	return yield* Effect.scoped(
		Effect.gen(function* () {
			const redis = yield* RedisService;
			const inspection = yield* inspectSandboxJournal(
				redis,
				payload.workflowExecutionId,
				payload.journalLength,
			);
			if (inspection === null) {
				return yield* new SandboxProjectionMissing();
			}
			const lease = yield* sandbox.reserve(payload.principal, payload.lane);
			const replayJournal = pinSandboxJournal(redis, payload.workflowExecutionId, inspection);

			const artifact = yield* artifacts.get(payload.principal);
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

			const exit = yield* sandbox
				.run({
					replayJournal,
					lane: payload.lane,
					context: payload.context,
					startedAt: payload.startedAt,
					principal: payload.principal,
					executionId: payload.executionId,
					compiledCode: artifact.compiledCode,
					compiledFormat: artifact.compiledFormat,
					workflowExecutionId: payload.workflowExecutionId,
					...(grants ? { grants } : {}),
					inlineDurableHost: {
						capabilities: inlineCapabilities,
						cancel: (progress) => dispatcher.cancelInline(payload.workflowExecutionId, progress),
						settle: (requests, wait, checkpoint) =>
							dispatcher.settleInline(
								requests,
								payload.context,
								payload.principal,
								payload.lane,
								payload.workflowExecutionId,
								payload.startedAt,
								wait,
								checkpoint,
							),
					},
				})
				.pipe(Effect.provideService(SandboxAdmissionLease, lease), Effect.exit);
			// A lost or rewritten projection decides the replay, whatever the script made of the failed read.
			const fault = replayJournal.fault();
			if (fault === "missing") {
				return yield* new SandboxProjectionMissing();
			}
			if (fault !== undefined) {
				return yield* new SandboxRunError({
					kind: "infrastructure",
					message:
						fault === "changed"
							? "Sandbox workflow journal changed after inspection"
							: "Sandbox workflow journal read failed",
				});
			}
			const result = yield* exit;

			return {
				logs: result.logs,
				error: result.error,
				value: result.value,
				timing: result.timing,
				inline: result.inline,
				harvest: result.harvest,
				recovery: result.recovery,
				status: "completed" as const,
				pendingInline: result.pendingInline,
			};
		}).pipe(
			Effect.catchIf(
				(error) => error instanceof SidecarRecoverySuspended,
				(error) => new SandboxRecoverySuspended({ instance: error.instance }),
			),
		),
	);
});

const makeSandboxExecutionQueueWorkerLive = (concurrency: number) =>
	DurableQueue.worker(
		SandboxExecutionQueue,
		(payload) => executeSandboxExecution(payload).pipe(Effect.mapError(toQueueError)),
		{ concurrency },
	);

export const SandboxExecutionQueueWorkerLive = Layer.unwrap(
	Effect.map(AppConfig, (config) =>
		makeSandboxExecutionQueueWorkerLive(config.sandbox.workerConcurrency),
	),
);

export const sandboxLaneCapacity = (workerConcurrency: number) => ({
	total: workerConcurrency,
	background: Math.max(1, Math.floor(workerConcurrency / 2)),
});

export const SandboxExecutionQueueStoreLive = Layer.unwrap(
	Effect.gen(function* () {
		const config = yield* AppConfig;
		return fairQueueStoreLayer({
			prefix: "ryot:sq:",
			flowOf: sandboxSchedulingKey,
			pollInterval: Duration.millis(25),
			capacity: sandboxLaneCapacity(config.sandbox.workerConcurrency),
		});
	}),
);
