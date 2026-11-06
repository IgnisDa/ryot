import { DbError } from "@ryot-app/contract/errors";
import type { AutomationWarning } from "@ryot-app/contract/modules/automations/lifecycle";
import type { AutomationRunId } from "@ryot-app/contract/schema/brands";
import { SANDBOX_LIMITS } from "@ryot-app/sandbox/protocol/limits";
import {
	Cause,
	Clock,
	Context,
	Duration,
	Effect,
	Layer,
	Option,
	Ref,
	Schema,
	type Scope,
} from "effect";
import { DurableClock } from "effect/workflow";
import { WorkflowEngine, WorkflowInstance } from "effect/workflow/WorkflowEngine";

import {
	AutomationPolicyExecutionError,
	LifecycleExecution,
} from "#modules/automations/lifecycle/execution";
import { LifecyclePersistenceError } from "#modules/automations/lifecycle/planning";
import { AccountAdmission } from "#modules/mutations/account-admission";
import { DirectScriptDeferred } from "#modules/scripts/executions/queues";
import { DatabaseSession } from "#platform/db/session";
import { JobQueue } from "#platform/jobs/queue";
import { startWorkflowDeadline } from "#platform/workflow/deadline";
import {
	awaitWorkflowSettled,
	WorkflowExecutionNotifications,
} from "#platform/workflow/execution-notifications";
import { ActivityBody, makeActivity } from "#platform/workflow/scope";

import { automationAttemptIdentity, AutomationAttemptRepository } from "./attempt-repository";
import {
	AutomationRunJob,
	type AutomationRunPayload,
	type AutomationRunResult,
	AutomationRunSettlement,
	settledAutomationRunResult,
} from "./run-job";
import { AutomationRunRepository } from "./run-repository";

const AUTOMATION_IMMEDIATE_TIMEOUT_SLACK_MS = 5_000;
export const AUTOMATION_IMMEDIATE_TIMEOUT_MS =
	SANDBOX_LIMITS.execution.timeoutMs + AUTOMATION_IMMEDIATE_TIMEOUT_SLACK_MS;
export const AUTOMATION_IMMEDIATE_CONCURRENCY = 8;

export type AutomationDispatchState = "fresh" | "closed" | "claimed";

export type AutomationDispatch = { readonly state: AutomationDispatchState };

export const dispatchStateOf = (
	row: undefined | { readonly status: string; readonly attemptCount: number },
): AutomationDispatchState => {
	if (!row || (row.attemptCount === 0 && row.status !== "queued")) {
		return "closed";
	}
	return row.attemptCount > 0 ? "claimed" : "fresh";
};

const runUnavailable = () => new DbError({ message: "Automation run is unavailable" });

const rootTransactionRequired = () =>
	new DbError({ message: "Automation admission requires a root transaction" });

export class AutomationExecutionOperations extends Context.Service<
	AutomationExecutionOperations,
	{
		skipQueuedPolicies: LifecycleExecution["Service"]["skipQueuedPolicies"];
		submit: (payload: AutomationRunPayload) => Effect.Effect<void, DbError>;
		settle: (
			payload: AutomationRunPayload,
			deadline: number,
		) => Effect.Effect<AutomationRunSettlement, DbError>;
		dispatchStates: (
			runIds: ReadonlyArray<AutomationRunId>,
		) => Effect.Effect<ReadonlyMap<AutomationRunId, AutomationDispatch>, DbError>;
	}
>()("@ryot-app/kernel-backend/modules/automations/execution/AutomationExecutionOperations") {}

export const AutomationExecutionOperationsLive = Layer.effect(
	AutomationExecutionOperations,
	Effect.gen(function* () {
		const runs = yield* AutomationRunRepository;
		const attempts = yield* AutomationAttemptRepository;
		const jobs = yield* JobQueue;
		const session = yield* DatabaseSession;
		const admission = yield* AccountAdmission.make;
		return AutomationExecutionOperations.of({
			skipQueuedPolicies: (input) => runs.skipQueuedPolicies(input),
			dispatchStates: (runIds) =>
				runs.listDispatchStates(runIds).pipe(
					Effect.map((rows) => {
						const rowsById = new Map(
							rows.map((row): [string, (typeof rows)[number]] => [row.id, row]),
						);
						return new Map(
							runIds.map((runId): [AutomationRunId, AutomationDispatch] => {
								const row = rowsById.get(runId);
								return [runId, { state: dispatchStateOf(row) }];
							}),
						);
					}),
				),
			settle: Effect.fnUntraced(function* (payload: AutomationRunPayload, deadline: number) {
				const attempt = yield* attempts.findAttempt(payload.runId, payload.attemptNumber);
				if (!attempt?.finishedAt || Date.parse(attempt.finishedAt) >= deadline) {
					return { _tag: "pending" } as const;
				}
				const run = yield* runs.findById(payload.runId);
				if (!run) {
					return yield* runUnavailable();
				}
				return {
					_tag: "completed",
					result: yield* settledAutomationRunResult(run.stage, attempt),
				} as const;
			}),
			submit: (payload) =>
				session
					.transaction(
						Effect.gen(function* () {
							const run = yield* runs.findById(payload.runId);
							if (!run) {
								return yield* runUnavailable();
							}
							if (run.executionUserId !== null) {
								yield* admission.admitAccount(yield* admission.currentAccount(run.executionUserId));
							}
							return yield* jobs.enqueue(AutomationRunJob, payload, {
								key: automationAttemptIdentity(payload.runId, payload.attemptNumber)
									.workflowExecutionId,
								...(run.executionUserId === null ? {} : { userId: run.executionUserId }),
							});
						}),
					)
					.pipe(
						Effect.asVoid,
						Effect.catchTags({
							SchemaError: Effect.die,
							DatabaseSessionStateError: rootTransactionRequired,
						}),
					),
		});
	}),
);

type DirectPolicyAttempt = (
	payload: AutomationRunPayload,
) => Effect.Effect<AutomationRunResult, DbError | DirectScriptDeferred>;

/**
 * Runs a first policy attempt in the caller's fiber; `DirectScriptDeferred` hands it to `AutomationRunJob`.
 * Migrations and the runtime share one layer graph and its memoized lifecycle services, so the runtime installs the
 * attempt once its sandbox exists; until then, and wherever nothing installs it, every attempt defers.
 */
export class DirectPolicyAttempts extends Context.Service<
	DirectPolicyAttempts,
	{
		readonly attempt: DirectPolicyAttempt;
		readonly install: (attempt: DirectPolicyAttempt) => Effect.Effect<void, never, Scope.Scope>;
	}
>()("@ryot-app/kernel-backend/modules/automations/execution/DirectPolicyAttempts") {
	static readonly layer = Layer.effect(
		this,
		Effect.gen(function* () {
			const installed = yield* Ref.make(Option.none<DirectPolicyAttempt>());
			return {
				install: (attempt) =>
					Effect.acquireRelease(Ref.set(installed, Option.some(attempt)), () =>
						Ref.set(installed, Option.none()),
					),
				attempt: (payload) =>
					Effect.flatMap(Ref.get(installed), (attempt) =>
						Option.isNone(attempt)
							? Effect.fail(new DirectScriptDeferred())
							: attempt.value(payload),
					),
			};
		}),
	);
}

// An activity body runs as request work: policies and hooks run directly, outside the workflow.
const workflowBody = Effect.flatMap(ActivityBody, (inActivity) =>
	inActivity ? Effect.succeedNone : Effect.serviceOption(WorkflowInstance),
);

export const OUTSIDE_WORKFLOW_BACKSTOP = Duration.millis(100);

const IN_WORKFLOW_POLL_START = Duration.millis(100);

const IN_WORKFLOW_POLL_LIMIT = Duration.seconds(2);

type RequiredRun = { readonly awaited: boolean; readonly payload: AutomationRunPayload };

const isSettled = (
	required: ReadonlyArray<RequiredRun>,
	settlements: ReadonlyArray<AutomationRunSettlement>,
) =>
	settlements.every(
		(settlement, index) => settlement._tag === "completed" || !required[index]?.awaited,
	);

export const LifecycleExecutionLive = Layer.effect(
	LifecycleExecution,
	Effect.gen(function* () {
		const operations = yield* AutomationExecutionOperations;
		const session = yield* DatabaseSession;
		const engine = yield* WorkflowEngine;
		const notifications = yield* WorkflowExecutionNotifications;
		const attempts = yield* DirectPolicyAttempts;
		const inWorkflow = <A, E>(
			instance: WorkflowInstance["Service"],
			effect: Effect.Effect<A, E, WorkflowEngine | WorkflowInstance>,
		) =>
			effect.pipe(
				Effect.provideService(WorkflowInstance, instance),
				Effect.provideService(WorkflowEngine, engine),
			);
		const startDeadline = Effect.fnUntraced(function* (name: string) {
			const instance = yield* workflowBody;
			return Option.isSome(instance)
				? yield* inWorkflow(
						instance.value,
						startWorkflowDeadline(name, AUTOMATION_IMMEDIATE_TIMEOUT_MS),
					)
				: (yield* Clock.currentTimeMillis) + AUTOMATION_IMMEDIATE_TIMEOUT_MS;
		});
		// Only an admitted submission starts a run, so a run is awaited only when its submission succeeded
		// here or something already claimed it. Parent replays read run states instead of submitting again.
		const awaitsDispatch = (state: AutomationDispatchState, payload: AutomationRunPayload) => {
			if (state === "claimed") {
				return Effect.succeed(true);
			}
			if (state === "closed") {
				return Effect.succeed(false);
			}
			return operations.submit(payload).pipe(
				Effect.as(true),
				Effect.catchCauseIf(
					(cause) => !Cause.hasInterruptsOnly(cause),
					(cause) =>
						Effect.logWarning("automation run submission failed", cause).pipe(Effect.as(false)),
				),
			);
		};
		const dispatchRuns = Effect.fnUntraced(function* (
			payloads: ReadonlyArray<AutomationRunPayload>,
		) {
			const states = yield* operations.dispatchStates(payloads.map(({ runId }) => runId)).pipe(
				Effect.catchCauseIf(
					(cause) => !Cause.hasInterruptsOnly(cause),
					(cause) =>
						Effect.logWarning("automation dispatch state read failed", cause).pipe(
							Effect.as(new Map<AutomationRunId, AutomationDispatch>()),
						),
				),
			);
			return yield* Effect.forEach(
				payloads,
				(payload) => {
					const { state } = states.get(payload.runId) ?? { state: "closed" };
					return Effect.map(awaitsDispatch(state, payload), (awaited) => ({ state, awaited }));
				},
				{ concurrency: AUTOMATION_IMMEDIATE_CONCURRENCY },
			);
		});
		const settleAll = (required: ReadonlyArray<RequiredRun>, deadline: number) =>
			Effect.forEach(required, ({ awaited, payload }) =>
				awaited
					? operations.settle(payload, deadline)
					: Effect.succeed({ _tag: "pending" } as const),
			);
		// Each poll and its deadline check are journaled, so a replay cannot change a recorded outcome.
		const awaitInWorkflow = Effect.fnUntraced(function* (
			name: string,
			required: ReadonlyArray<RequiredRun>,
			deadline: number,
		) {
			for (let poll = 0; ; poll += 1) {
				const { expired, settlements } = yield* makeActivity({
					error: DbError,
					name: `settle-${name}-${poll}`,
					success: Schema.Struct({
						expired: Schema.Boolean,
						settlements: Schema.Array(AutomationRunSettlement),
					}),
					execute: Effect.all({
						settlements: settleAll(required, deadline),
						expired: Effect.map(Clock.currentTimeMillis, (now) => now >= deadline),
					}),
				});
				if (expired || isSettled(required, settlements)) {
					return settlements;
				}
				yield* DurableClock.sleep({
					name: `hook-wait-${name}-${poll}`,
					inMemoryThreshold: IN_WORKFLOW_POLL_LIMIT,
					duration: Duration.min(
						Duration.times(IN_WORKFLOW_POLL_START, 2 ** Math.min(poll, 10)),
						IN_WORKFLOW_POLL_LIMIT,
					),
				});
			}
		});
		const awaitOutside = Effect.fnUntraced(function* (
			required: ReadonlyArray<RequiredRun>,
			deadline: number,
		) {
			const now = yield* Clock.currentTimeMillis;
			return yield* awaitWorkflowSettled({
				identities: [],
				backstop: OUTSIDE_WORKFLOW_BACKSTOP,
				read: settleAll(required, deadline),
				timeout: Duration.millis(Math.max(0, deadline - now)),
				isSettled: (settlements) => isSettled(required, settlements),
			}).pipe(Effect.provideService(WorkflowExecutionNotifications, notifications));
		});
		const settleRequired = (name: string, required: ReadonlyArray<RequiredRun>, deadline: number) =>
			Effect.flatMap(workflowBody, (instance) =>
				Option.isSome(instance)
					? inWorkflow(instance.value, awaitInWorkflow(name, required, deadline))
					: awaitOutside(required, deadline),
			);
		// In a workflow the direct attempt is journaled, so a replay never runs it again on a different path.
		const runPolicy = Effect.fnUntraced(function* (name: string, payload: AutomationRunPayload) {
			const direct = attempts.attempt(payload).pipe(
				Effect.map((result) => ({ result, _tag: "completed" as const })),
				Effect.catchTag("DirectScriptDeferred", () => Effect.succeed(null)),
			);
			const instance = yield* workflowBody;
			const settled = Option.isNone(instance)
				? yield* direct
				: yield* inWorkflow(
						instance.value,
						makeActivity({
							error: DbError,
							execute: direct,
							name: `direct-${name}`,
							success: Schema.NullOr(AutomationRunSettlement),
						}),
					);
			if (settled !== null) {
				return settled;
			}
			const deadline = yield* startDeadline(name);
			const [dispatch] = yield* dispatchRuns([payload]);
			// A claim seen in a workflow may be a direct attempt whose process died, so a job takes it over.
			if (dispatch?.state === "claimed" && Option.isSome(instance)) {
				yield* operations.submit(payload).pipe(
					Effect.catchCauseIf(
						(cause) => !Cause.hasInterruptsOnly(cause),
						(cause) => Effect.logWarning("automation run takeover failed", cause),
					),
				);
			}
			const awaited = dispatch?.awaited === true;
			const [settlement] = yield* settleRequired(
				name,
				dispatch ? [{ payload, awaited }] : [],
				deadline,
			);
			return settlement;
		});
		const after = Effect.fnUntraced(function* ({
			runs,
			triggerId,
		}: Parameters<LifecycleExecution["Service"]["after"]>[0]) {
			const eligible = runs.filter(
				(run) => run.triggerId === triggerId && run.status !== "skipped",
			);
			if (eligible.length === 0) {
				return [];
			}
			const deadline = yield* startDeadline(`after-${triggerId}`);
			const entries = eligible.map((run) => ({
				run,
				payload: { runId: run.id, attemptNumber: 1, acceptedPatches: [] },
			}));
			const dispatched = yield* dispatchRuns(entries.map(({ payload }) => payload));
			const required = entries.flatMap(({ run, payload }, index) => {
				const dispatch = dispatched[index];
				return run.delivery === "async" || !dispatch ? [] : [{ run, payload, ...dispatch }];
			});
			if (required.length === 0) {
				return [];
			}
			const settlements = yield* settleRequired(`after-${triggerId}`, required, deadline);
			return required.flatMap(({ run }, index): Array<AutomationWarning> => {
				const settlement = settlements[index];
				const status =
					settlement?._tag === "completed" ? settlement.result.attempt?.status : undefined;
				if (status === "succeeded") {
					return [];
				}
				return [
					{
						runId: run.id,
						hookSlug: run.hookSlug,
						code: status === "failed" ? "required-hook-failed" : "required-hook-pending",
					},
				];
			});
		});
		return LifecycleExecution.of({
			after,
			skipQueuedPolicies: operations.skipQueuedPolicies,
			dispatch: (plans) =>
				Effect.gen(function* () {
					yield* session.requireRoot.pipe(
						Effect.mapError(
							() => new LifecyclePersistenceError({ code: "postcommit-requires-root" }),
						),
					);
					const warnings: AutomationWarning[] = [];
					for (const plan of plans) {
						if (plan.blockedReason?.hasRequiredHooks) {
							warnings.push({ ...plan.blockedReason, triggerId: plan.triggerId });
						}
						warnings.push(...(yield* after({ runs: plan.runs, triggerId: plan.triggerId })));
					}
					return warnings;
				}),
			executeBatchPolicy: ({
				runId,
				acceptedReferences,
				acceptedBatchPatches,
				activeItemIdentities,
			}) =>
				Effect.gen(function* () {
					const payload = {
						runId,
						attemptNumber: 1,
						acceptedReferences,
						acceptedPatches: [],
						acceptedBatchPatches,
						activeItemIdentities,
					};
					const settlement = yield* runPolicy(`policy-${runId}`, payload);
					const output =
						settlement?._tag === "completed" && settlement.result.attempt?.status === "succeeded"
							? settlement.result.policyOutput
							: null;
					return output !== null && "items" in output
						? output
						: yield* new AutomationPolicyExecutionError({ runId, code: "policy-execution-failed" });
				}).pipe(
					Effect.mapError(
						() => new AutomationPolicyExecutionError({ runId, code: "policy-execution-failed" }),
					),
				),
			executePolicy: ({ runId, acceptedPatches }) =>
				Effect.gen(function* () {
					const settlement = yield* runPolicy(`policy-${runId}`, {
						runId,
						acceptedPatches,
						attemptNumber: 1,
					});
					return settlement?._tag === "completed" &&
						settlement.result.attempt?.status === "succeeded" &&
						settlement.result.policyOutput !== null &&
						"action" in settlement.result.policyOutput
						? settlement.result.policyOutput
						: yield* new AutomationPolicyExecutionError({ runId, code: "policy-execution-failed" });
				}).pipe(
					Effect.mapError(
						() => new AutomationPolicyExecutionError({ runId, code: "policy-execution-failed" }),
					),
					Effect.catchCauseIf(
						(cause) => !Cause.hasInterruptsOnly(cause),
						() => new AutomationPolicyExecutionError({ runId, code: "policy-execution-failed" }),
					),
				),
		});
	}),
);
