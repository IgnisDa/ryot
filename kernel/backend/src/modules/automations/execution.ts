import type { DbError } from "@ryot-app/contract/errors";
import type { AutomationWarning } from "@ryot-app/contract/modules/automations/lifecycle";
import { Cause, Clock, Context, Duration, Effect, Layer } from "effect";
import { WorkflowEngine } from "effect/unstable/workflow/WorkflowEngine";

import {
	AutomationPolicyExecutionError,
	LifecycleExecution,
} from "#lib/domain/lifecycle-execution";
import { Database } from "#lib/infrastructure/db/service";
import { SANDBOX_LIMITS } from "#lib/infrastructure/sandbox-runtime/limits";

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

export const LifecycleExecutionLive = Layer.effect(
	LifecycleExecution,
	Effect.gen(function* () {
		const operations = yield* AutomationExecutionOperations;
		return LifecycleExecution.of({
			skipQueuedPolicies: operations.skipQueuedPolicies,
			executePolicy: ({ runId, payload }) =>
				operations.execute({ runId, attemptNumber: 1, policyPayload: payload }).pipe(
					Effect.timeout(Duration.millis(AUTOMATION_IMMEDIATE_TIMEOUT_MS)),
					Effect.flatMap((result) =>
						result.attempt?.status === "succeeded" && result.policyOutput !== null
							? Effect.succeed(result.policyOutput)
							: new AutomationPolicyExecutionError({ runId, code: "policy-execution-failed" }),
					),
					Effect.mapError(
						() => new AutomationPolicyExecutionError({ runId, code: "policy-execution-failed" }),
					),
					Effect.catchCauseIf(
						(cause) => !Cause.hasInterruptsOnly(cause),
						() => new AutomationPolicyExecutionError({ runId, code: "policy-execution-failed" }),
					),
				),
			after: ({ runs, triggerId }) =>
				Effect.gen(function* () {
					const deadline = (yield* Clock.currentTimeMillis) + AUTOMATION_IMMEDIATE_TIMEOUT_MS;
					const eligible = runs.filter(
						(run) =>
							run.triggerId === triggerId && run.stage === "after" && run.status !== "skipped",
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
										const payload = { runId: run.id, attemptNumber: 1 };
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
				}),
		});
	}),
);
