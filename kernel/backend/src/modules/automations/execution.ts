import { DbError } from "@ryot-app/contract/errors";
import type { AutomationWarning } from "@ryot-app/contract/modules/automations/lifecycle";
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
import { ActivityBody, implementWorkflow, makeActivity } from "#lib/infrastructure/workflow-scope";
import { MutationReceipts } from "#modules/mutations/receipts";
import { dispatchAdmittedWorkflow } from "#modules/mutations/workflow-dispatch";

import { AutomationAttemptRepository, automationAttemptIdentity } from "./attempt-repository";
import { AutomationRunRepository } from "./run-repository";
import {
	AutomationObservation,
	AutomationObservationWorkflow,
	type AutomationObservationWorkflowPayload,
	AutomationRunWorkflow,
	type AutomationRunWorkflowPayload,
	automationObservationExecutionId,
	settledAutomationRunResult,
} from "./run-workflow";

export const AUTOMATION_IMMEDIATE_TIMEOUT_MS = SANDBOX_LIMITS.execution.timeoutMs + 5_000;
export const AUTOMATION_IMMEDIATE_CONCURRENCY = 8;

export class AutomationExecutionOperations extends Context.Service<
	AutomationExecutionOperations,
	{
		skipQueuedPolicies: LifecycleExecution["Service"]["skipQueuedPolicies"];
		submit: (payload: AutomationRunWorkflowPayload) => Effect.Effect<void, DbError>;
		settle: (
			payload: AutomationRunWorkflowPayload,
			deadline: number,
		) => Effect.Effect<AutomationObservation, DbError>;
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
			settle: (payload, deadline) =>
				Effect.gen(function* () {
					const attempt = yield* attempts.findAttempt(payload.runId, payload.attemptNumber);
					if (!attempt?.finishedAt || Date.parse(attempt.finishedAt) >= deadline) {
						return { _tag: "expired" } as const;
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
					const account = yield* session
						.transaction(
							Effect.gen(function* () {
								const run = yield* runs.findById(payload.runId);
								if (!run) {
									return yield* new DbError({ message: "Automation run is unavailable" });
								}
								if (run.executionUserId === null) {
									return null;
								}
								const currentAccount = yield* receipts.currentAccount(run.executionUserId);
								if (!(yield* runs.findById(payload.runId))) {
									return yield* new DbError({ message: "Automation run is unavailable" });
								}
								return currentAccount;
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
						AutomationRunWorkflow,
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

const runPayload = (
	payload: AutomationObservationWorkflowPayload,
): AutomationRunWorkflowPayload => ({
	runId: payload.runId,
	attemptNumber: payload.attemptNumber,
	acceptedPatches: payload.acceptedPatches,
});

export const AutomationObservationWorkflowDefinitionsLive = implementWorkflow(
	AutomationObservationWorkflow,
	Effect.fnUntraced(function* (payload) {
		const operations = yield* AutomationExecutionOperations;
		const engine = yield* WorkflowEngine;
		const run = runPayload(payload);
		yield* operations.submit(run);
		const remaining = payload.deadline - (yield* Clock.currentTimeMillis);
		yield* DurableDeferred.raceAll({
			name: "observation",
			error: Schema.Never,
			success: Schema.Void,
			effects: [
				engine
					.execute(AutomationRunWorkflow, {
						payload: run,
						executionId: automationAttemptIdentity(run.runId, run.attemptNumber)
							.workflowExecutionId,
					})
					.pipe(Effect.ignore),
				// A durable clock with a positive duration suspends on every replay, so a run whose reply
				// already exists always wins the race.
				DurableClock.sleep({
					name: "deadline",
					inMemoryThreshold: Duration.zero,
					duration: Duration.millis(Math.max(remaining, 1)),
				}),
			],
		});
		return yield* makeActivity({
			error: DbError,
			name: "settle-observation",
			success: AutomationObservation,
			execute: operations.settle(run, payload.deadline),
		});
	}),
);

const observation = (payload: AutomationRunWorkflowPayload, deadline: number) => ({
	payload: { ...payload, deadline },
	executionId: automationObservationExecutionId(payload.runId, payload.attemptNumber),
});

// Outside a workflow instance the engine re-sends a suspended observer's run request on this schedule.
const OUTSIDE_WORKFLOW_RECHECK = Schedule.spaced(Duration.millis(50));

export const LifecycleExecutionLive = Layer.effect(
	LifecycleExecution,
	Effect.gen(function* () {
		const operations = yield* AutomationExecutionOperations;
		const session = yield* DatabaseSession;
		const engine = yield* WorkflowEngine;
		const startDeadline = Effect.fnUntraced(function* (name: string) {
			const instance = yield* Effect.serviceOption(WorkflowInstance);
			return Option.isSome(instance)
				? yield* startWorkflowDeadline(name, AUTOMATION_IMMEDIATE_TIMEOUT_MS).pipe(
						Effect.provideService(WorkflowInstance, instance.value),
						Effect.provideService(WorkflowEngine, engine),
					)
				: (yield* Clock.currentTimeMillis) + AUTOMATION_IMMEDIATE_TIMEOUT_MS;
		});
		const dispatchObservation = (payload: AutomationRunWorkflowPayload, deadline: number) =>
			engine.execute(AutomationObservationWorkflow, {
				...observation(payload, deadline),
				discard: true,
			});
		const awaitObservation = (payload: AutomationRunWorkflowPayload, deadline: number) =>
			engine.execute(AutomationObservationWorkflow, {
				...observation(payload, deadline),
				suspendedRetrySchedule: OUTSIDE_WORKFLOW_RECHECK,
			});
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
				const payloadOf = (run: (typeof eligible)[number]): AutomationRunWorkflowPayload => ({
					runId: run.id,
					attemptNumber: 1,
					acceptedPatches: [],
				});
				// Every run is dispatched before any wait, so a waiting run's suspension cannot interrupt a
				// sibling's dispatch.
				yield* Effect.forEach(
					eligible,
					(run) =>
						(run.delivery === "async"
							? operations.submit(payloadOf(run))
							: dispatchObservation(payloadOf(run), deadline)
						).pipe(
							Effect.catchCauseIf(
								(cause) => !Cause.hasInterruptsOnly(cause),
								() => Effect.void,
							),
						),
					{ discard: true, concurrency: AUTOMATION_IMMEDIATE_CONCURRENCY },
				);
				const warnings = yield* Effect.forEach(
					eligible.filter((run) => run.delivery !== "async"),
					(run) => {
						const warning = (
							code: "required-hook-pending" | "required-hook-failed",
						): AutomationWarning => ({ code, runId: run.id, hookSlug: run.hookSlug });
						return awaitObservation(payloadOf(run), deadline).pipe(
							Effect.map((observed) => {
								if (observed._tag === "expired") {
									return warning("required-hook-pending");
								}
								const status = observed.result.attempt?.status;
								if (status === "succeeded") {
									return null;
								}
								return warning(
									status === "failed" ? "required-hook-failed" : "required-hook-pending",
								);
							}),
							Effect.catchCauseIf(
								(cause) => !Cause.hasInterruptsOnly(cause),
								() => Effect.succeed(warning("required-hook-pending")),
							),
						);
					},
					{ concurrency: AUTOMATION_IMMEDIATE_CONCURRENCY },
				);
				return warnings.filter((warning) => warning !== null);
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
							const observed = yield* awaitObservation(payload, deadline);
							return observed._tag === "completed" &&
								observed.result.attempt?.status === "succeeded" &&
								observed.result.policyOutput !== null
								? observed.result.policyOutput
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
