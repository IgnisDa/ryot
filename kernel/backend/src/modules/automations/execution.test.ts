import { expect, layer } from "@effect/vitest";
import { DbError } from "@ryot-app/contract/errors";
import { AutomationRunId } from "@ryot-app/contract/schema/brands";
import { Cause, Context, Deferred, Effect, Exit, Layer, Ref, Schema } from "effect";
import { Workflow } from "effect/workflow";
import { WorkflowEngine, WorkflowInstance } from "effect/workflow/WorkflowEngine";

import {
	LifecycleDispatchRun,
	LifecyclePersistenceError,
	type LifecycleDispatchPlan,
} from "#lib/domain/lifecycle";
import {
	AutomationPolicyExecutionError,
	LifecycleExecution,
} from "#lib/domain/lifecycle-execution";
import { DatabaseSession, DatabaseSessionStateError } from "#lib/infrastructure/db/session";
import { implementWorkflow, makeActivity } from "#lib/infrastructure/workflow-scope";
import { assertExitFails } from "#lib/test-utils/assertions";
import {
	databaseLayer,
	makeWorkflowActivityEngine,
	workflowEngineTestLayer,
} from "#lib/test-utils/effect";

import { automationAttemptIdentity } from "./attempt-repository";
import {
	AutomationExecutionOperations,
	AutomationExecutionOperationsLive,
	LifecycleExecutionLive,
} from "./execution";
import { triggerFixture, queuedRunFixture } from "./lifecycle.test-support";
import { AutomationRunRepository } from "./run-repository";
import type { AutomationRunWorkflowPayload, AutomationRunWorkflowResult } from "./run-workflow";
import {
	RunWorkflowSubmissions,
	recordingRunWorkflowEngineLayer,
} from "./run-workflow-engine.test-support";

const trigger = triggerFixture();
const run = (id: string, delivery: "required" | "async" = "required") =>
	Schema.decodeSync(LifecycleDispatchRun)({
		id,
		delivery,
		hookSlug: id,
		stage: "after",
		status: "queued",
		triggerId: trigger.id,
	});
const result = (
	runId: AutomationRunId,
	status: "succeeded" | "failed" = "succeeded",
): AutomationRunWorkflowResult => ({
	policyOutput: null,
	attempt: {
		...automationAttemptIdentity(runId, 1),
		runId,
		status,
		timing: null,
		attemptNumber: 1,
		retryable: status === "failed",
		startedAt: new Date(0).toISOString(),
		finishedAt: new Date(0).toISOString(),
		failureKind: status === "failed" ? "sandbox-timeout" : null,
	},
});
type Operations = AutomationExecutionOperations["Service"];

class ExecutionCalls extends Context.Service<
	ExecutionCalls,
	{
		readonly submitted: Effect.Effect<ReadonlyArray<string>>;
		readonly executed: Effect.Effect<ReadonlyArray<AutomationRunWorkflowPayload>>;
		readonly skipped: Effect.Effect<ReadonlyArray<string>>;
		readonly setTransactionActive: (active: boolean) => Effect.Effect<void>;
	}
>()("test/ExecutionCalls") {}

const lifecycleExecutionLayer = (makeOperations: Effect.Effect<Operations>) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const operations = yield* makeOperations;
			const submitted = yield* Ref.make<ReadonlyArray<string>>([]);
			const executed = yield* Ref.make<ReadonlyArray<AutomationRunWorkflowPayload>>([]);
			const skipped = yield* Ref.make<ReadonlyArray<string>>([]);
			const transactionActive = yield* Ref.make(false);
			return LifecycleExecutionLive.pipe(
				Layer.provide(
					Layer.mergeAll(
						Layer.succeed(
							AutomationExecutionOperations,
							AutomationExecutionOperations.of({
								poll: (payload) =>
									Ref.update(executed, (all) => [...all, payload]).pipe(
										Effect.andThen(operations.poll(payload)),
									),
								submit: (payload) =>
									Ref.update(submitted, (all) => [...all, payload.runId]).pipe(
										Effect.andThen(operations.submit(payload)),
									),
								skipQueuedPolicies: (input) =>
									Ref.update(skipped, (all) => [...all, input.triggerId]).pipe(
										Effect.andThen(operations.skipQueuedPolicies(input)),
									),
							}),
						),
						Layer.mock(DatabaseSession)({
							requireRoot: Effect.flatMap(Ref.get(transactionActive), (active) =>
								active
									? Effect.fail(
											new DatabaseSessionStateError({ reason: "transaction-already-active" }),
										)
									: Effect.void,
							),
						}),
					),
				),
				Layer.merge(
					Layer.succeed(ExecutionCalls, {
						skipped: Ref.get(skipped),
						executed: Ref.get(executed),
						submitted: Ref.get(submitted),
						setTransactionActive: (active) => Ref.set(transactionActive, active),
					}),
				),
				Layer.provideMerge(workflowEngineTestLayer),
			);
		}),
	);

const succeedingOperations = Effect.succeed(
	AutomationExecutionOperations.of({
		submit: () => Effect.void,
		skipQueuedPolicies: () => Effect.void,
		poll: ({ runId }) => Effect.succeed(result(runId)),
	}),
);
const policyPatch = { resource: "entity", draft: { name: "Changed" } } as const;

layer(
	lifecycleExecutionLayer(
		Effect.gen(function* () {
			const started = yield* Deferred.make<void>();
			const executions = yield* Ref.make(0);
			return AutomationExecutionOperations.of({
				skipQueuedPolicies: () => Effect.void,
				submit: (payload) =>
					payload.runId === "async"
						? Effect.fail(new DbError({ message: "async failure" }))
						: Effect.void,
				poll: ({ runId }) =>
					Effect.gen(function* () {
						if ((yield* Ref.updateAndGet(executions, (count) => count + 1)) === 3) {
							yield* Deferred.succeed(started, undefined);
						}
						yield* Deferred.await(started);
						if (runId === "submission-failed") {
							return yield* new DbError({ message: "offline" });
						}
						return result(runId, runId === "retry" ? "failed" : "succeeded");
					}),
			});
		}),
	),
)((test) => {
	test.effect(
		"runs required hooks concurrently with all-settled warnings and discards async failures",
		() =>
			Effect.gen(function* () {
				const runs = [
					run("success"),
					run("retry"),
					run("submission-failed"),
					run("async", "async"),
				];
				const warnings = yield* Effect.flatMap(LifecycleExecution, (service) =>
					service.after({ runs, triggerId: trigger.id }),
				);
				expect(warnings).toEqual([
					{ runId: "retry", hookSlug: "retry", code: "required-hook-failed" },
					{
						runId: "submission-failed",
						code: "required-hook-pending",
						hookSlug: "submission-failed",
					},
				]);
				expect(yield* (yield* ExecutionCalls).submitted).toEqual([
					"success",
					"retry",
					"submission-failed",
					"async",
				]);
			}),
	);
});

layer(
	lifecycleExecutionLayer(
		Effect.succeed(
			AutomationExecutionOperations.of({
				submit: () => Effect.void,
				poll: () => Effect.interrupt,
				skipQueuedPolicies: () => Effect.void,
			}),
		),
	),
)((test) => {
	test.effect("preserves durable suspension while waiting for a required hook", () =>
		Effect.gen(function* () {
			const exit = yield* Effect.flatMap(LifecycleExecution, (service) =>
				service.after({ triggerId: trigger.id, runs: [run("required")] }),
			).pipe(Effect.exit);
			expect(exit._tag).toBe("Failure");
			if (exit._tag === "Failure") {
				expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true);
			}
		}),
	);
});

layer(
	lifecycleExecutionLayer(
		Effect.succeed(
			AutomationExecutionOperations.of({
				submit: () => Effect.void,
				skipQueuedPolicies: () => Effect.void,
				poll: (payload) =>
					Effect.gen(function* () {
						if (payload.runId === "db") {
							return yield* new DbError({ message: "private database connection details" });
						}
						if (payload.runId === "defect") {
							return yield* Effect.die("private infrastructure details");
						}
						const completed = result(
							payload.runId,
							payload.runId === "failed" ? "failed" : "succeeded",
						);
						if (completed.attempt === null) {
							return yield* Effect.die("Expected completed attempt fixture");
						}
						return {
							...completed,
							policyOutput: { patch: policyPatch, action: "transform" as const },
						};
					}),
			}),
		),
	),
)((test) => {
	test.effect(
		"returns policy output and maps infrastructure failures to the stable run-ID error",
		() =>
			Effect.gen(function* () {
				const service = yield* LifecycleExecution;
				expect(
					yield* service.executePolicy({
						acceptedPatches: [policyPatch],
						runId: AutomationRunId.make("accepted"),
					}),
				).toEqual({ patch: policyPatch, action: "transform" });
				assertExitFails(
					yield* Effect.exit(
						service.executePolicy({ acceptedPatches: [], runId: AutomationRunId.make("failed") }),
					),
					new AutomationPolicyExecutionError({
						code: "policy-execution-failed",
						runId: AutomationRunId.make("failed"),
					}),
				);
				assertExitFails(
					yield* Effect.exit(
						service.executePolicy({ acceptedPatches: [], runId: AutomationRunId.make("db") }),
					),
					new AutomationPolicyExecutionError({
						code: "policy-execution-failed",
						runId: AutomationRunId.make("db"),
					}),
				);
				assertExitFails(
					yield* Effect.exit(
						service.executePolicy({ acceptedPatches: [], runId: AutomationRunId.make("defect") }),
					),
					new AutomationPolicyExecutionError({
						code: "policy-execution-failed",
						runId: AutomationRunId.make("defect"),
					}),
				);
				expect(yield* (yield* ExecutionCalls).executed).toEqual(
					["accepted", "failed", "db", "defect"].map((runId) => ({
						runId,
						attemptNumber: 1,
						acceptedPatches: runId === "accepted" ? [policyPatch] : [],
					})),
				);
			}),
	);
});

layer(
	AutomationExecutionOperationsLive.pipe(
		Layer.provide(
			Layer.mock(AutomationRunRepository)({
				findById: (id) => Effect.succeed(queuedRunFixture(id)),
			}),
		),
		Layer.provideMerge(databaseLayer),
		Layer.provideMerge(recordingRunWorkflowEngineLayer()),
	),
)((test) => {
	test.effect("submits deterministic workflow IDs without waiting for either delivery", () =>
		Effect.gen(function* () {
			const operations = yield* AutomationExecutionOperations;
			yield* operations.submit({
				attemptNumber: 1,
				acceptedPatches: [],
				runId: AutomationRunId.make("required"),
			});
			yield* operations.submit({
				attemptNumber: 1,
				acceptedPatches: [],
				runId: AutomationRunId.make("async"),
			});
			expect(yield* yield* RunWorkflowSubmissions).toEqual(
				["required", "async"].map((id) => ({
					discard: true,
					payload: { runId: id, attemptNumber: 1, acceptedPatches: [] },
					executionId: automationAttemptIdentity(AutomationRunId.make(id), 1).workflowExecutionId,
				})),
			);
		}),
	);
});

const cleanupFailure = new DbError({ message: "cleanup unavailable" });

layer(
	lifecycleExecutionLayer(
		Effect.gen(function* () {
			const skips = yield* Ref.make(0);
			return AutomationExecutionOperations.of({
				poll: () => Effect.die("unused"),
				submit: () => Effect.die("unused"),
				skipQueuedPolicies: () =>
					Effect.flatMap(
						Ref.updateAndGet(skips, (count) => count + 1),
						(count) => (count === 2 ? Effect.fail(cleanupFailure) : Effect.void),
					),
			});
		}),
	),
)((test) => {
	test.effect(
		"closes the abandoned trigger through the execution port and preserves cleanup DbError",
		() =>
			Effect.gen(function* () {
				const service = yield* LifecycleExecution;
				yield* service.skipQueuedPolicies({ triggerId: trigger.id });
				assertExitFails(
					yield* Effect.exit(service.skipQueuedPolicies({ triggerId: trigger.id })),
					cleanupFailure,
				);
				expect(yield* (yield* ExecutionCalls).skipped).toEqual([trigger.id, trigger.id]);
			}),
	);
});

layer(
	lifecycleExecutionLayer(
		Effect.succeed(
			AutomationExecutionOperations.of({
				submit: () => Effect.void,
				skipQueuedPolicies: () => Effect.void,
				poll: ({ runId }) => Effect.succeed(result(runId, "failed")),
			}),
		),
	),
)((test) => {
	test.effect(
		"dispatches plans in order with blocked warnings and rejects an open transaction",
		() =>
			Effect.gen(function* () {
				const calls = yield* ExecutionCalls;
				const blockedReason = {
					omittedHooks: [],
					hasRequiredHooks: true,
					code: "automation-limit-reached",
				};
				const plans: ReadonlyArray<LifecycleDispatchPlan> = [
					{ blockedReason: null, runs: [run("first")], triggerId: trigger.id },
					{
						triggerId: trigger.id,
						runs: [run("second")],
						blockedReason: { ...blockedReason, code: "automation-limit-reached" as const },
					},
				];
				const service = yield* LifecycleExecution;
				expect(yield* service.dispatch(plans)).toEqual([
					{ runId: "first", hookSlug: "first", code: "required-hook-failed" },
					{ ...blockedReason, triggerId: trigger.id },
					{ runId: "second", hookSlug: "second", code: "required-hook-failed" },
				]);
				yield* calls.setTransactionActive(true);
				assertExitFails(
					yield* Effect.exit(service.dispatch(plans)),
					new LifecyclePersistenceError({ code: "postcommit-requires-root" }),
				);
				yield* calls.setTransactionActive(false);
				expect((yield* calls.executed).map(({ runId }) => runId)).toEqual(["first", "second"]);
			}),
	);
});

const expectActivityDefect = (exit: Exit.Exit<unknown, unknown>, operation: string) => {
	expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true);
	if (Exit.isFailure(exit)) {
		expect(Cause.pretty(exit.cause)).toContain(
			`LifecycleExecution.${operation} must run in a workflow body, not an activity`,
		);
	}
};

const GuardChildWorkflow = Workflow.make("LifecycleGuardChildWorkflow", {
	success: Schema.Finite,
	payload: { executionId: Schema.String },
	idempotencyKey: ({ executionId }) => executionId,
});
const GuardParentWorkflow = Workflow.make("LifecycleGuardParentWorkflow", {
	success: Schema.Finite,
	payload: { executionId: Schema.String },
	idempotencyKey: ({ executionId }) => executionId,
});

layer(lifecycleExecutionLayer(succeedingOperations))((test) => {
	test.effect("rejects lifecycle execution inside activities", () =>
		Effect.gen(function* () {
			const service = yield* LifecycleExecution;
			const instance = WorkflowInstance.initial(GuardChildWorkflow, "guard-activity");
			const inActivity = <A, E>(name: string, execute: Effect.Effect<A, E>) =>
				Effect.exit(makeActivity({ name, execute: Effect.ignore(execute) })).pipe(
					Effect.provideService(WorkflowInstance, instance),
					Effect.provideService(WorkflowEngine, makeWorkflowActivityEngine(instance)),
				);
			expectActivityDefect(
				yield* inActivity("after", service.after({ runs: [run("hook")], triggerId: trigger.id })),
				"after",
			);
			expectActivityDefect(
				yield* inActivity(
					"policy",
					service.executePolicy({ acceptedPatches: [], runId: AutomationRunId.make("policy") }),
				),
				"executePolicy",
			);
			expect(yield* service.after({ runs: [run("hook")], triggerId: trigger.id })).toEqual([]);
		}),
	);
});

const guardWorkflowsLayer = Layer.unwrap(
	Effect.map(LifecycleExecution, (service) =>
		Layer.mergeAll(
			implementWorkflow(GuardChildWorkflow, () =>
				service.after({ runs: [run("hook")], triggerId: trigger.id }).pipe(
					Effect.map((warnings) => warnings.length),
					Effect.orDie,
				),
			),
			implementWorkflow(GuardParentWorkflow, ({ executionId }) =>
				makeActivity({
					name: "start-child",
					success: Schema.Finite,
					execute: GuardChildWorkflow.execute({ executionId: `${executionId}-child` }),
				}),
			),
		),
	),
).pipe(
	Layer.provideMerge(workflowEngineTestLayer),
	Layer.provide(lifecycleExecutionLayer(succeedingOperations)),
);

layer(guardWorkflowsLayer)((test) => {
	test.effect("allows lifecycle execution in workflow bodies started from an activity", () =>
		Effect.gen(function* () {
			expect(yield* GuardParentWorkflow.execute({ executionId: "guard-parent" })).toBe(0);
		}),
	);
});
