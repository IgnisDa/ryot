import { SandboxRunError } from "@ryot-app/contract/errors";
import { ExecutionLane } from "@ryot-app/contract/modules/automations/lifecycle";
import { SandboxExecutionGrants } from "@ryot-app/contract/modules/scripts/schemas";
import { workflowReplayJournalEntrySchema } from "@ryot-app/plugin-backend-sdk/workflow";
import { SandboxAdmissionLease } from "@ryot-app/sandbox/host/admission";
import { SandboxExecutor } from "@ryot-app/sandbox/host/executor";
import { sandboxInlineDurableCapabilities } from "@ryot-app/sandbox/host/host-execution-policy";
import { SandboxRecoveryIdentity } from "@ryot-app/sandbox/host/recovery-store";
import { SidecarRecoverySuspended } from "@ryot-app/sandbox/host/supervisor";
import { isObjectRecord } from "@ryot-app/ts-utils/predicates";
import { Duration, Effect, Layer, Schema } from "effect";
import { DurableQueue } from "effect/workflow";

import { ScriptExecutionPrincipal } from "#modules/scripts/authorization/principal";
import { ScriptInlineProgress } from "#modules/scripts/host/http-progress";
import { inspectSandboxJournal, pinSandboxJournal } from "#modules/scripts/replay/journal-store";
import { AppConfig } from "#platform/config/service";
import { RedisService } from "#platform/redis";
import { fairQueueStoreLayer } from "#platform/workflow/fair-queue-store";

import { isSandboxCapabilityAllowed } from "../authorization/capabilities";
import { SandboxDurableHostDispatcher } from "../host/durable-dispatcher";
import { ExecutableArtifacts } from "../registry/executable-artifacts";
import { KernelWorkflowReferences } from "../registry/kernel-workflow-references";
import { SandboxExecutionResult } from "./result";
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
	principal: ScriptExecutionPrincipal,
	grants: Schema.optional(SandboxExecutionGrants),
	recoveryAttempt: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
});
export type SandboxExecutionQueuePayload = Schema.Schema.Type<typeof SandboxExecutionQueuePayload>;

const SandboxReplayResult = Schema.Struct({
	recovery: Schema.optional(SandboxRecoveryIdentity),
	...SandboxExecutionResult.fields,
	pendingInline: Schema.Array(ScriptInlineProgress),
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
		const runtime = yield* SandboxExecutor;
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
	const artifacts = yield* ExecutableArtifacts;
	const sandbox = yield* SandboxExecutor;
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
			const inlineCapabilities = sandboxInlineDurableCapabilities(payload.principal).filter(
				(capability) => isSandboxCapabilityAllowed(payload, capability),
			);
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
			const pendingInline = yield* Schema.decodeUnknownEffect(Schema.Array(ScriptInlineProgress))(
				result.pendingInline,
			).pipe(
				Effect.mapError(
					() =>
						new SandboxRunError({
							kind: "infrastructure",
							message: "Sandbox inline progress is invalid",
						}),
				),
			);

			return {
				pendingInline,
				logs: result.logs,
				error: result.error,
				value: result.value,
				timing: result.timing,
				inline: result.inline,
				harvest: result.harvest,
				recovery: result.recovery,
				status: "completed" as const,
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
