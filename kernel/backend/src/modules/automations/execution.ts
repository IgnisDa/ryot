import { DbError } from "@ryot-app/contract/errors";
import type { AutomationWarning } from "@ryot-app/contract/modules/automations/lifecycle";
import { Cause, Clock, Context, Effect, Layer, Option } from "effect";
import { WorkflowEngine, WorkflowInstance } from "effect/workflow/WorkflowEngine";

import { LifecyclePersistenceError } from "#lib/domain/lifecycle";
import {
	AutomationPolicyExecutionError,
	LifecycleExecution,
} from "#lib/domain/lifecycle-execution";
import { DatabaseSession } from "#lib/infrastructure/db/session";
import { SANDBOX_LIMITS } from "#lib/infrastructure/sandbox-runtime/limits";
import {
	observeWorkflowDeadline,
	startWorkflowDeadline,
} from "#lib/infrastructure/workflow-deadline";
import { ActivityBody } from "#lib/infrastructure/workflow-scope";
import { MutationReceipts } from "#modules/mutations/receipts";
import { dispatchAdmittedWorkflow } from "#modules/mutations/workflow-dispatch";

import { automationAttemptIdentity } from "./attempt-repository";
import { AutomationRunRepository } from "./run-repository";
import {
	type AutomationRunWorkflowResult,
	AutomationRunWorkflow,
	type AutomationRunWorkflowPayload,
} from "./run-workflow";

export const AUTOMATION_IMMEDIATE_TIMEOUT_MS = SANDBOX_LIMITS.execution.timeoutMs + 5_000;
export const AUTOMATION_IMMEDIATE_CONCURRENCY = 8;

export class AutomationExecutionOperations extends Context.Service<
	AutomationExecutionOperations,
	{
		skipQueuedPolicies: LifecycleExecution["Service"]["skipQueuedPolicies"];
		submit: (payload: AutomationRunWorkflowPayload) => Effect.Effect<void, DbError>;
		poll: (
			payload: AutomationRunWorkflowPayload,
		) => Effect.Effect<AutomationRunWorkflowResult | null, DbError>;
	}
>()("AutomationExecutionOperations") {}

export const AutomationExecutionOperationsLive = Layer.effect(
	AutomationExecutionOperations,
	Effect.gen(function* () {
		const engine = yield* WorkflowEngine;
		const runs = yield* AutomationRunRepository;
		const session = yield* DatabaseSession;
		const receipts = yield* MutationReceipts.make;
		return AutomationExecutionOperations.of({
			skipQueuedPolicies: (input) => runs.skipQueuedPolicies(input),
			poll: (payload) =>
				Effect.gen(function* () {
					const executionId = automationAttemptIdentity(
						payload.runId,
						payload.attemptNumber,
					).workflowExecutionId;
					const observed = Option.getOrUndefined(
						yield* engine.poll(AutomationRunWorkflow, executionId),
					);
					if (!observed || observed._tag === "Suspended") {
						return null;
					}
					return yield* observed.exit;
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

const attemptCompletedAt = (value: AutomationRunWorkflowResult) =>
	value.attempt ? Date.parse(value.attempt.finishedAt ?? value.attempt.startedAt) : null;

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
		const observeAttempt = Effect.fnUntraced(function* (
			deadline: number,
			payload: AutomationRunWorkflowPayload,
		) {
			const instance = yield* Effect.serviceOption(WorkflowInstance);
			return yield* observeWorkflowDeadline({
				deadline,
				poll: operations.poll(payload),
				completedAt: attemptCompletedAt,
				pollingIntervalMs: Option.isSome(instance) ? 1_000 : 500,
			});
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
				const warnings = yield* Effect.forEach(
					eligible,
					(run) =>
						Effect.gen(function* () {
							const payload = { runId: run.id, attemptNumber: 1, acceptedPatches: [] };
							const warning = (
								code: "required-hook-pending" | "required-hook-failed",
							): AutomationWarning => ({ code, runId: run.id, hookSlug: run.hookSlug });
							yield* operations.submit(payload);
							if (run.delivery === "async") {
								return null;
							}
							const observed = yield* observeAttempt(deadline, payload);
							if (observed.status === "expired") {
								return warning("required-hook-pending");
							}
							return observed.value.attempt?.status === "succeeded"
								? null
								: warning(
										observed.value.attempt?.status === "failed"
											? "required-hook-failed"
											: "required-hook-pending",
									);
						}).pipe(
							Effect.catchCauseIf(
								(cause) => !Cause.hasInterruptsOnly(cause),
								() =>
									Effect.succeed(
										run.delivery === "async"
											? null
											: ({
													runId: run.id,
													hookSlug: run.hookSlug,
													code: "required-hook-pending",
												} satisfies AutomationWarning),
									),
							),
						),
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
							yield* operations.submit(payload);
							const observed = yield* observeAttempt(deadline, payload);
							return observed.status === "completed" &&
								observed.value.attempt?.status === "succeeded" &&
								observed.value.policyOutput !== null
								? observed.value.policyOutput
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
