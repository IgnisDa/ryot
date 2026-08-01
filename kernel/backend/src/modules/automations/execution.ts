import { PgClient } from "@effect/sql-pg";
import type { DbError } from "@ryot-app/contract/errors";
import type { AutomationWarning } from "@ryot-app/contract/modules/automations/lifecycle";
import { Cause, Clock, Context, Duration, Effect, Layer, Option } from "effect";
import { WorkflowEngine } from "effect/unstable/workflow/WorkflowEngine";

import { LifecyclePersistenceError } from "#lib/domain/lifecycle";
import {
	AutomationPolicyExecutionError,
	LifecycleExecution,
} from "#lib/domain/lifecycle-execution";
import { Database } from "#lib/infrastructure/db/service";
import { SANDBOX_LIMITS } from "#lib/infrastructure/sandbox-runtime/limits";
import { ActivityBody } from "#lib/infrastructure/workflow-scope";

import { automationAttemptIdentity } from "./attempt-repository";
import { AutomationRunRepository } from "./run-repository";
import {
	AutomationRunWorkflow,
	type AutomationRunWorkflowPayload,
	type AutomationRunWorkflowResult,
} from "./run-workflow";

export const AUTOMATION_IMMEDIATE_TIMEOUT_MS = SANDBOX_LIMITS.execution.timeoutMs + 5_000;
export const AUTOMATION_IMMEDIATE_CONCURRENCY = 8;

export class AutomationExecutionOperations extends Context.Service<
	AutomationExecutionOperations,
	{
		skipQueuedPolicies: LifecycleExecution["Service"]["skipQueuedPolicies"];
		submit: (payload: AutomationRunWorkflowPayload) => Effect.Effect<void, DbError>;
		execute: (
			payload: AutomationRunWorkflowPayload,
		) => Effect.Effect<AutomationRunWorkflowResult, DbError>;
	}
>()("AutomationExecutionOperations") {}

export const AutomationExecutionOperationsLive = Layer.effect(
	AutomationExecutionOperations,
	Effect.gen(function* () {
		const engine = yield* WorkflowEngine;
		const runs = yield* AutomationRunRepository;
		const database = yield* Database;
		return AutomationExecutionOperations.of({
			skipQueuedPolicies: (input) =>
				runs.skipQueuedPolicies(input).pipe(Effect.provideService(Database, database)),
			execute: (payload) =>
				engine.execute(AutomationRunWorkflow, {
					payload,
					executionId: automationAttemptIdentity(payload.runId, payload.attemptNumber)
						.workflowExecutionId,
				}),
			submit: (payload) =>
				engine.execute(AutomationRunWorkflow, {
					payload,
					discard: true,
					executionId: automationAttemptIdentity(payload.runId, payload.attemptNumber)
						.workflowExecutionId,
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

export const LifecycleExecutionLive = Layer.effect(
	LifecycleExecution,
	Effect.gen(function* () {
		const operations = yield* AutomationExecutionOperations;
		const sqlClient = yield* PgClient.PgClient;
		const after: LifecycleExecution["Service"]["after"] = ({ runs, triggerId }) =>
			Effect.gen(function* () {
				yield* requireWorkflowBody("after");
				const deadline = (yield* Clock.currentTimeMillis) + AUTOMATION_IMMEDIATE_TIMEOUT_MS;
				const eligible = runs.filter(
					(run) => run.triggerId === triggerId && run.status !== "skipped",
				);
				return yield* Effect.forEach(
					[
						eligible.filter((run) => run.delivery === "async"),
						eligible.filter((run) => run.delivery === "required"),
					],
					(group) =>
						Effect.forEach(
							group,
							(run) =>
								Effect.gen(function* () {
									const payload = { runId: run.id, attemptNumber: 1, acceptedPatches: [] };
									const warning = (
										code: "required-hook-pending" | "required-hook-failed",
									): AutomationWarning => ({ code, runId: run.id, hookSlug: run.hookSlug });
									const remaining = deadline - (yield* Clock.currentTimeMillis);
									if (remaining <= 0) {
										return run.delivery === "async" ? null : warning("required-hook-pending");
									}
									return yield* (
										run.delivery === "async"
											? operations.submit(payload).pipe(Effect.as(null))
											: operations
													.execute(payload)
													.pipe(
														Effect.map((result) =>
															result.attempt?.status === "succeeded"
																? null
																: warning(
																		result.attempt?.status === "failed"
																			? "required-hook-failed"
																			: "required-hook-pending",
																	),
														),
													)
									).pipe(
										Effect.timeoutOrElse({
											duration: Duration.millis(remaining),
											orElse: () =>
												Effect.succeed(
													run.delivery === "async" ? null : warning("required-hook-pending"),
												),
										}),
										Effect.catchCauseIf(
											(cause) => !Cause.hasInterruptsOnly(cause),
											() =>
												Effect.succeed(
													run.delivery === "async" ? null : warning("required-hook-pending"),
												),
										),
									);
								}),
							{ concurrency: AUTOMATION_IMMEDIATE_CONCURRENCY },
						),
					{ concurrency: 2 },
				).pipe(Effect.map((groups) => groups.flat().filter((warning) => warning !== null)));
			});
		return LifecycleExecution.of({
			after,
			skipQueuedPolicies: operations.skipQueuedPolicies,
			dispatch: (plans) =>
				Effect.gen(function* () {
					if (Option.isSome(yield* Effect.serviceOption(sqlClient.transactionService))) {
						return yield* new LifecyclePersistenceError({ code: "postcommit-requires-root" });
					}
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
						operations.execute({ runId, acceptedPatches, attemptNumber: 1 }).pipe(
							Effect.timeout(Duration.millis(AUTOMATION_IMMEDIATE_TIMEOUT_MS)),
							Effect.flatMap((result) =>
								result.attempt?.status === "succeeded" && result.policyOutput !== null
									? Effect.succeed(result.policyOutput)
									: new AutomationPolicyExecutionError({ runId, code: "policy-execution-failed" }),
							),
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
