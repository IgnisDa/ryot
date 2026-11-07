import { SandboxRunError } from "@ryot-app/contract/errors";
import { ExecutionLane } from "@ryot-app/contract/modules/automations/lifecycle";
import {
	SandboxExecutionGrants,
	sandboxSubjectUserId,
} from "@ryot-app/contract/modules/scripts/schemas";
import { workflowReplayJournalEntrySchema } from "@ryot-app/plugin-backend-sdk/workflow";
import { SandboxAdmissionLease } from "@ryot-app/sandbox/host/admission";
import { SandboxExecutor } from "@ryot-app/sandbox/host/executor";
import { sandboxInlineDurableCapabilities } from "@ryot-app/sandbox/host/host-execution-policy";
import { SandboxRecoveryIdentity } from "@ryot-app/sandbox/host/recovery-store";
import { SidecarRecoverySuspended } from "@ryot-app/sandbox/host/supervisor";
import { SANDBOX_LIMITS } from "@ryot-app/sandbox/protocol/limits";
import { isObjectRecord } from "@ryot-app/ts-utils/predicates";
import { Context, Duration, Effect, Exit, Layer, Option, Schema } from "effect";
import { Activity, DurableDeferred } from "effect/workflow";
import { WorkflowEngine } from "effect/workflow/WorkflowEngine";

import { ScriptExecutionPrincipal } from "#modules/scripts/authorization/principal";
import { ScriptInlineProgress } from "#modules/scripts/host/http-progress";
import { inspectSandboxJournal, pinSandboxJournal } from "#modules/scripts/replay/journal-store";
import { AppConfig } from "#platform/config/service";
import { DatabaseSession } from "#platform/db/session";
import { JobQueue, makeJobKind } from "#platform/jobs/queue";
import { CurrentJobId, registerJobHandler } from "#platform/jobs/worker";

import { isSandboxCapabilityAllowed } from "../authorization/capabilities";
import { SandboxDurableHostDispatcher } from "../host/durable-dispatcher";
import { ExecutableArtifacts } from "../registry/executable-artifacts";
import { KernelWorkflowReferences } from "../registry/kernel-workflow-references";
import { SandboxExecutionResult } from "./result";
import { infrastructureRunError } from "./run-error";
import { sandboxReplayPriority } from "./scheduling-key";

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

/** The replay's journal projection entries were lost, so the script never ran. */
export class SandboxProjectionMissing extends Schema.TaggedError<
	SandboxProjectionMissing,
	{ readonly brand: unique symbol }
>()("SandboxProjectionMissing", {}) {}

export class SandboxRecoverySuspended extends Schema.TaggedError<
	SandboxRecoverySuspended,
	{ readonly brand: unique symbol }
>()("SandboxRecoverySuspended", { instance: Schema.String }) {}

export const sandboxRecoveryExecutionId = (executionId: string, attempt: number) =>
	`${executionId}-recovery-${attempt}`;

const toQueueError = (error: unknown) =>
	error instanceof SandboxRunError ||
	error instanceof SandboxRecoverySuspended ||
	error instanceof SandboxProjectionMissing
		? error
		: infrastructureRunError(error);

const SandboxExecutionQueueError = Schema.Union([
	SandboxRunError,
	SandboxRecoverySuspended,
	SandboxProjectionMissing,
]);

const replayKey = ({ executionId, recoveryAttempt }: SandboxExecutionQueuePayload) =>
	recoveryAttempt === undefined || recoveryAttempt === 0
		? executionId
		: sandboxRecoveryExecutionId(executionId, recoveryAttempt);

const replayOutcome = (name: string) =>
	DurableDeferred.make(name, { success: SandboxReplayResult, error: SandboxExecutionQueueError });

const SandboxReplayJobPayload = Schema.Struct({
	token: DurableDeferred.Token,
	payload: SandboxExecutionQueuePayload,
});

// A replay that fails reports it through the workflow's deferred, so only a process crash uses an attempt. Running out
// would leave the workflow waiting forever.
const replayJob = (name: string) =>
	makeJobKind(name, {
		maxAttempts: 100,
		backoff: Duration.seconds(1),
		payload: SandboxReplayJobPayload,
	});

const SandboxReplayInteractiveJob = replayJob("sandbox-replay-interactive");
const SandboxReplayBackgroundJob = replayJob("sandbox-replay-background");

const replayDeferred = Effect.fnUntraced(function* (payload: SandboxExecutionQueuePayload) {
	const id = yield* Activity.idempotencyKey(`sandbox-replay/${replayKey(payload)}`);
	return { id, deferred: replayOutcome(`sandbox-replay/${id}`) };
});

export const processSandboxExecutionQueue = Effect.fn("processSandboxExecutionQueue")(function* (
	payload: SandboxExecutionQueuePayload,
) {
	const { id, deferred } = yield* replayDeferred(payload);
	const engine = yield* WorkflowEngine;
	const jobs = yield* JobQueue;
	// A settled job's row is gone, and a body that runs again must not start the replay again.
	if (Option.isNone(yield* engine.deferredResult(deferred))) {
		const token = yield* DurableDeferred.token(deferred);
		const userId = sandboxSubjectUserId(payload.principal.subject);
		yield* jobs
			.enqueue(
				payload.lane === "interactive" ? SandboxReplayInteractiveJob : SandboxReplayBackgroundJob,
				{ token, payload },
				{ id, priority: sandboxReplayPriority(payload), ...(userId === null ? {} : { userId }) },
			)
			.pipe(Effect.orDie);
	}
	const result = yield* DurableDeferred.await(deferred).pipe(Effect.mapError(toQueueError));
	if (result.recovery !== undefined) {
		const runtime = yield* SandboxExecutor;
		yield* runtime.completeRecovery(result.recovery);
	}
	return result;
});

/**
 * The stored result of a replay whose first attempt succeeded without recovery state to clear,
 * read from the deferred its job reports to. A workflow body runs again after every settled step;
 * reading the result spares it offering the replay and projecting its journal again.
 */
export const settledSandboxReplay = Effect.fn("settledSandboxReplay")(function* (
	payload: SandboxExecutionQueuePayload,
) {
	const { deferred } = yield* replayDeferred(payload);
	const engine = yield* WorkflowEngine;
	const exit = yield* engine.deferredResult(deferred);
	return Option.isSome(exit) &&
		Exit.isSuccess(exit.value) &&
		exit.value.value.recovery === undefined
		? Option.some(exit.value.value)
		: Option.none<SandboxReplayResult>();
});

export type SandboxAdmission = "queued" | "direct";

export type SandboxExecutionResolutionMode = "exact" | "active";

/** A direct run reached work that only `ScriptExecutionWorkflow`'s queue and replay loop can wait for. */
export class DirectScriptDeferred extends Schema.TaggedError<
	DirectScriptDeferred,
	{ readonly brand: unique symbol }
>()("DirectScriptDeferred", {}) {}

// A direct run may be nested in a parked isolate's host call, and a parked isolate keeps its admission lease, so
// it never waits long for one: two parked parents waiting on each other's leases would deadlock.
const DIRECT_ADMISSION_WAIT = Duration.millis(SANDBOX_LIMITS.replay.shortWaitMs);

// An inline batch keeps its lane's transient pool, which fits one batch, until its host calls settle. A script
// nested in one of those calls could never get a batch on that lane while its parent waits for it.
export const HeldInlineBatch = Context.Reference<null | ExecutionLane>(
	"@ryot-app/kernel-backend/modules/scripts/executions/queues/HeldInlineBatch",
	{ defaultValue: () => null },
);

const otherLane = (lane: ExecutionLane): ExecutionLane =>
	lane === "interactive" ? "background" : "interactive";

export const executeSandboxExecution = Effect.fn("executeSandboxExecution")(function* (
	payload: SandboxExecutionQueuePayload,
	admission: SandboxAdmission = "queued",
) {
	const held = yield* HeldInlineBatch;
	const lane = held === payload.lane ? otherLane(held) : payload.lane;
	yield* Effect.annotateCurrentSpan({
		executionId: payload.executionId,
		scriptId: payload.principal.scriptId,
		...("userId" in payload.principal.subject ? { userId: payload.principal.subject.userId } : {}),
	});
	const artifacts = yield* ExecutableArtifacts;
	const sandbox = yield* SandboxExecutor;
	const dispatcher = yield* SandboxDurableHostDispatcher;
	const carry = yield* Effect.flatMap(DatabaseSession, (session) => session.carry);
	const jobId = yield* CurrentJobId;
	return yield* Effect.scoped(
		Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const inspection = yield* inspectSandboxJournal(
				session,
				payload.workflowExecutionId,
				payload.journalLength,
			);
			if (inspection === null) {
				return yield* new SandboxProjectionMissing();
			}
			const reservation = sandbox.reserve(payload.principal, lane);
			const lease = yield* admission === "queued"
				? reservation
				: reservation.pipe(
						Effect.timeoutOrElse({
							duration: DIRECT_ADMISSION_WAIT,
							orElse: () => Effect.fail(new DirectScriptDeferred()),
						}),
						Effect.catchIf(
							(error) => error instanceof SandboxRunError && error.kind === "resource-unavailable",
							() => Effect.fail(new DirectScriptDeferred()),
						),
					);
			const replayJournal = pinSandboxJournal(session, payload.workflowExecutionId, inspection);

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
					lane,
					replayJournal,
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
						settle: (requests, wait, checkpoint) =>
							carry(
								dispatcher.settleInline(
									requests,
									payload.context,
									payload.principal,
									lane,
									payload.workflowExecutionId,
									payload.startedAt,
									wait,
									checkpoint,
								),
							).pipe(
								Effect.provideService(HeldInlineBatch, lane),
								// Host calls run on the resident sidecar's fibers, which keep the job that started it.
								Effect.provideService(CurrentJobId, jobId),
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

export const sandboxLaneCapacity = (workerConcurrency: number) => ({
	total: workerConcurrency,
	background: Math.max(1, Math.floor(workerConcurrency / 2)),
});

const runReplay = ({ token, payload }: typeof SandboxReplayJobPayload.Type) =>
	executeSandboxExecution(payload).pipe(
		Effect.mapError(toQueueError),
		Effect.exit,
		Effect.flatMap((exit) =>
			DurableDeferred.done(replayOutcome("sandbox-replay"), { exit, token }),
		),
		Effect.asVoid,
	);

export const SandboxReplayJobsLive = Layer.unwrap(
	Effect.map(AppConfig, (config) => {
		const capacity = sandboxLaneCapacity(config.sandbox.workerConcurrency);
		return Layer.merge(
			registerJobHandler(
				{ ...SandboxReplayInteractiveJob, concurrency: capacity.total },
				runReplay,
			),
			registerJobHandler(
				{ ...SandboxReplayBackgroundJob, concurrency: capacity.background },
				runReplay,
			),
		);
	}),
);
