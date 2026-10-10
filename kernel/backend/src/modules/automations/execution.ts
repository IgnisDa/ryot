import { DbError } from "@ryot-app/contract/errors";
import type {
	AutomationWarning,
	ExecutionLane,
} from "@ryot-app/contract/modules/automations/lifecycle";
import type { AutomationRunId } from "@ryot-app/contract/schema/brands";
import { Cause, Clock, Context, Duration, Effect, Layer, Option, Schedule, Schema } from "effect";
import { DurableClock, DurableDeferred } from "effect/workflow";
import { WorkflowEngine, WorkflowInstance } from "effect/workflow/WorkflowEngine";

import { LifecyclePersistenceError } from "#lib/domain/lifecycle";
import {
	AutomationPolicyExecutionError,
	LifecycleExecution,
} from "#lib/domain/lifecycle-execution";
import { DatabaseSession } from "#lib/infrastructure/db/session";
import { SANDBOX_LIMITS } from "#lib/infrastructure/sandbox-runtime/limits";
import { startWorkflowDeadline } from "#lib/infrastructure/workflow-deadline";
import { ActivityBody, makeActivity } from "#lib/infrastructure/workflow-scope";
import { MutationReceipts } from "#modules/mutations/receipts";
import { dispatchAdmittedWorkflow } from "#modules/mutations/workflow-dispatch";

import { AutomationAttemptRepository, automationAttemptIdentity } from "./attempt-repository";
import { AutomationRunRepository } from "./run-repository";
import {
	AutomationRunSettlement,
	AutomationRunWorkflow,
	type AutomationRunWorkflowPayload,
	settledAutomationRunResult,
} from "./run-workflow";

export const AUTOMATION_IMMEDIATE_TIMEOUT_MS = SANDBOX_LIMITS.execution.timeoutMs + 5_000;
export const AUTOMATION_IMMEDIATE_CONCURRENCY = 8;

export type AutomationDispatchState = "claimed" | "closed" | "fresh";

export type AutomationDispatch = {
	readonly lane: ExecutionLane;
	readonly state: AutomationDispatchState;
};

const dispatchStateOf = (
	row: { readonly attemptCount: number; readonly status: string } | undefined,
): AutomationDispatchState => {
	if (!row || (row.attemptCount === 0 && row.status !== "queued")) {
		return "closed";
	}
	return row.attemptCount > 0 ? "claimed" : "fresh";
};

export class AutomationExecutionOperations extends Context.Service<
	AutomationExecutionOperations,
	{
		dispatchStates: (
			runIds: ReadonlyArray<AutomationRunId>,
		) => Effect.Effect<ReadonlyMap<AutomationRunId, AutomationDispatch>, DbError>;
		skipQueuedPolicies: LifecycleExecution["Service"]["skipQueuedPolicies"];
		submit: (payload: AutomationRunWorkflowPayload) => Effect.Effect<void, DbError>;
		settle: (
			payload: AutomationRunWorkflowPayload,
			deadline: number,
		) => Effect.Effect<AutomationRunSettlement, DbError>;
	}
>()("AutomationExecutionOperations") {}

export const AutomationExecutionOperationsLive = Layer.effect(
	AutomationExecutionOperations,
	Effect.gen(function* () {
		const engine = yield* WorkflowEngine;
		const runs = yield* AutomationRunRepository;
		const attempts = yield* AutomationAttemptRepository;
		const session = yield* DatabaseSession;
		const receipts = yield* MutationReceipts.make;
		return AutomationExecutionOperations.of({
			skipQueuedPolicies: (input) => runs.skipQueuedPolicies(input),
			dispatchStates: (runIds) =>
				runs.listDispatchStates(runIds).pipe(
					Effect.map(
						(rows) =>
							new Map(
								runIds.map((runId): [AutomationRunId, AutomationDispatch] => {
									const row = rows.find(({ id }) => id === runId);
									return [runId, { state: dispatchStateOf(row), lane: row?.lane ?? "background" }];
								}),
							),
					),
				),
			settle: (payload, deadline) =>
				Effect.gen(function* () {
					const attempt = yield* attempts.findAttempt(payload.runId, payload.attemptNumber);
					if (!attempt?.finishedAt || Date.parse(attempt.finishedAt) >= deadline) {
						return { _tag: "pending" } as const;
					}
					const run = yield* runs.findById(payload.runId);
					if (!run) {
						return yield* new DbError({ message: "Automation run is unavailable" });
					}
					return {
						_tag: "completed",
						result: yield* settledAutomationRunResult(run.stage, attempt),
					} as const;
				}),
			submit: (payload) =>
				Effect.gen(function* () {
					const executionId = automationAttemptIdentity(
						payload.runId,
						payload.attemptNumber,
					).workflowExecutionId;
					const { lane, account } = yield* session
						.transaction(
							Effect.gen(function* () {
								const run = yield* runs.findById(payload.runId);
								const [dispatch] = yield* runs.listDispatchStates([payload.runId]);
								if (!run || !dispatch) {
									return yield* new DbError({ message: "Automation run is unavailable" });
								}
								if (run.executionUserId === null) {
									return { account: null, lane: dispatch.lane };
								}
								const currentAccount = yield* receipts.currentAccount(run.executionUserId);
								if (!(yield* runs.findById(payload.runId))) {
									return yield* new DbError({ message: "Automation run is unavailable" });
								}
								return { lane: dispatch.lane, account: currentAccount };
							}),
						)
						.pipe(
							Effect.catchTag(
								"DatabaseSessionStateError",
								() => new DbError({ message: "Automation admission requires a root transaction" }),
							),
						);
					return yield* dispatchAdmittedWorkflow(
						receipts,
						engine,
						AutomationRunWorkflow.forLane(lane),
						account,
						{ payload, executionId, discard: true },
						(admission) =>
							session
								.transaction(
									Effect.gen(function* () {
										if (!(yield* runs.findById(payload.runId))) {
											return yield* new DbError({ message: "Automation run is unavailable" });
										}
										return yield* admission;
									}),
								)
								.pipe(
									Effect.catchTag(
										"DatabaseSessionStateError",
										() =>
											new DbError({ message: "Automation admission requires a root transaction" }),
									),
								),
						(execution) => execution,
					);
				}),
		});
	}),
);

const requireWorkflowBody = (operation: string) =>
	Effect.flatMap(ActivityBody, (inActivity) =>
		inActivity
			? Effect.die(`LifecycleExecution.${operation} must run in a workflow body, not an activity`)
			: Effect.void,
	);

const OUTSIDE_WORKFLOW_RECHECK = Duration.millis(50);

type RequiredRun = {
	readonly awaited: boolean;
	readonly lane: ExecutionLane;
	readonly payload: AutomationRunWorkflowPayload;
};

export const LifecycleExecutionLive = Layer.effect(
	LifecycleExecution,
	Effect.gen(function* () {
		const operations = yield* AutomationExecutionOperations;
		const session = yield* DatabaseSession;
		const engine = yield* WorkflowEngine;
		const inWorkflow = <A, E>(
			instance: WorkflowInstance["Service"],
			effect: Effect.Effect<A, E, WorkflowEngine | WorkflowInstance>,
		) =>
			effect.pipe(
				Effect.provideService(WorkflowInstance, instance),
				Effect.provideService(WorkflowEngine, engine),
			);
		const startDeadline = Effect.fnUntraced(function* (name: string) {
			const instance = yield* Effect.serviceOption(WorkflowInstance);
			return Option.isSome(instance)
				? yield* inWorkflow(
						instance.value,
						startWorkflowDeadline(name, AUTOMATION_IMMEDIATE_TIMEOUT_MS),
					)
				: (yield* Clock.currentTimeMillis) + AUTOMATION_IMMEDIATE_TIMEOUT_MS;
		});
		// Only an admitted submission starts a run, so a run is awaited only when it was claimed or its
		// submission succeeded here. Parent replays read run states instead of submitting again.
		const dispatchRuns = (payloads: ReadonlyArray<AutomationRunWorkflowPayload>) =>
			Effect.gen(function* () {
				const states = yield* operations.dispatchStates(payloads.map(({ runId }) => runId)).pipe(
					Effect.catchCauseIf(
						(cause) => !Cause.hasInterruptsOnly(cause),
						() => Effect.succeed(new Map<AutomationRunId, AutomationDispatch>()),
					),
				);
				return yield* Effect.forEach(
					payloads,
					(payload) => {
						const { lane, state } = states.get(payload.runId) ?? {
							state: "closed",
							lane: "background",
						};
						const awaited =
							state === "fresh"
								? operations.submit(payload).pipe(
										Effect.as(true),
										Effect.catchCauseIf(
											(cause) => !Cause.hasInterruptsOnly(cause),
											() => Effect.succeed(false),
										),
									)
								: Effect.succeed(state === "claimed");
						return Effect.map(awaited, (value) => ({ lane, awaited: value }));
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
		// The winner of the race is journaled, so a run exiting after the deadline or a clock firing after
		// the runs cannot change a recorded outcome.
		const awaitInWorkflow = (
			name: string,
			required: ReadonlyArray<RequiredRun>,
			deadline: number,
		) =>
			Effect.gen(function* () {
				const instance = yield* WorkflowInstance;
				const deadlineClock = DurableClock.make({
					name: `hook-wait-${name}`,
					duration: Duration.millis(Math.max(deadline - (yield* Clock.currentTimeMillis), 1)),
				});
				yield* DurableDeferred.raceAll({
					error: Schema.Never,
					success: Schema.Void,
					name: `hooks-${name}`,
					effects: [
						Effect.forEach(
							required.filter(({ awaited }) => awaited),
							({ lane, payload }) =>
								engine
									.execute(AutomationRunWorkflow.forLane(lane), {
										payload,
										executionId: automationAttemptIdentity(payload.runId, payload.attemptNumber)
											.workflowExecutionId,
									})
									.pipe(Effect.ignore),
							{ discard: true, concurrency: "unbounded" },
						),
						DurableClock.sleep({
							name: deadlineClock.name,
							inMemoryThreshold: Duration.zero,
							duration: deadlineClock.duration,
						}),
					],
				});
				// The engine cannot cancel a losing clock; once the race is settled the run stops awaiting it,
				// so its later firing does not preempt the running workflow.
				instance.awaitedDeferreds.delete(deadlineClock.deferred.name);
				return yield* makeActivity({
					error: DbError,
					name: `settle-${name}`,
					execute: settleAll(required, deadline),
					success: Schema.Array(AutomationRunSettlement),
				});
			});
		const awaitOutside = (required: ReadonlyArray<RequiredRun>, deadline: number) =>
			Effect.all([settleAll(required, deadline), Clock.currentTimeMillis]).pipe(
				Effect.repeat({
					schedule: Schedule.spaced(OUTSIDE_WORKFLOW_RECHECK),
					until: ([settlements, now]) =>
						now >= deadline ||
						settlements.every(
							(settlement, index) => settlement._tag === "completed" || !required[index]?.awaited,
						),
				}),
				Effect.map(([settlements]) => settlements),
			);
		const settleRequired = (name: string, required: ReadonlyArray<RequiredRun>, deadline: number) =>
			Effect.flatMap(Effect.serviceOption(WorkflowInstance), (instance) =>
				Option.isSome(instance)
					? inWorkflow(instance.value, awaitInWorkflow(name, required, deadline))
					: awaitOutside(required, deadline),
			);
		const after: LifecycleExecution["Service"]["after"] = ({ runs, triggerId }) =>
			Effect.gen(function* () {
				yield* requireWorkflowBody("after");
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
			executePolicy: ({ runId, acceptedPatches }) =>
				requireWorkflowBody("executePolicy").pipe(
					Effect.andThen(
						Effect.gen(function* () {
							const payload = { runId, acceptedPatches, attemptNumber: 1 };
							const deadline = yield* startDeadline(`policy-${runId}`);
							const [dispatch] = yield* dispatchRuns([payload]);
							const [settlement] = yield* settleRequired(
								`policy-${runId}`,
								dispatch ? [{ payload, ...dispatch }] : [],
								deadline,
							);
							return settlement?._tag === "completed" &&
								settlement.result.attempt?.status === "succeeded" &&
								settlement.result.policyOutput !== null
								? settlement.result.policyOutput
								: yield* new AutomationPolicyExecutionError({
										runId,
										code: "policy-execution-failed",
									});
						}).pipe(
							Effect.mapError(
								() =>
									new AutomationPolicyExecutionError({ runId, code: "policy-execution-failed" }),
							),
							Effect.catchCauseIf(
								(cause) => !Cause.hasInterruptsOnly(cause),
								() =>
									new AutomationPolicyExecutionError({ runId, code: "policy-execution-failed" }),
							),
						),
					),
				),
		});
	}),
);
