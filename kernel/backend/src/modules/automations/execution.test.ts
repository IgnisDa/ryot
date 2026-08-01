import { PgClient } from "@effect/sql-pg";
import { expect, it } from "@effect/vitest";
import { DbError } from "@ryot-app/contract/errors";
import { AutomationRunId } from "@ryot-app/contract/schema/brands";
import { Cause, Deferred, Duration, Effect, Exit, Fiber, Layer, Schema } from "effect";
import { TestClock } from "effect/testing";
import { SqlClient } from "effect/unstable/sql";
import { Workflow } from "effect/unstable/workflow";
import { WorkflowEngine, WorkflowInstance } from "effect/unstable/workflow/WorkflowEngine";

import {
	LifecycleDispatchRun,
	LifecyclePersistenceError,
	type LifecycleDispatchPlan,
} from "#lib/domain/lifecycle";
import {
	AutomationPolicyExecutionError,
	LifecycleExecution,
} from "#lib/domain/lifecycle-execution";
import { implementWorkflow, makeActivity } from "#lib/infrastructure/workflow-scope";
import { assertExitFails } from "#lib/test-utils/assertions";
import {
	databaseLayer,
	makeWorkflowActivityEngine,
	makeWorkflowEngine,
	workflowEngineTestLayer,
} from "#lib/test-utils/effect";

import { automationAttemptIdentity } from "./attempt-repository";
import {
	AUTOMATION_IMMEDIATE_CONCURRENCY,
	AUTOMATION_IMMEDIATE_TIMEOUT_MS,
	AutomationExecutionOperations,
	AutomationExecutionOperationsLive,
	LifecycleExecutionLive,
} from "./execution";
import { triggerFixture } from "./lifecycle.test-support";
import { AutomationRunRepository } from "./run-repository";
import { AutomationRunWorkflowPayload, type AutomationRunWorkflowResult } from "./run-workflow";

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
		startedAt: trigger.createdAt,
		finishedAt: trigger.createdAt,
		retryable: status === "failed",
		failureKind: status === "failed" ? "sandbox-timeout" : null,
	},
});
const transactionService = SqlClient.TransactionConnection(0);
const layer = (operations: AutomationExecutionOperations["Service"]) =>
	LifecycleExecutionLive.pipe(
		Layer.provide(
			Layer.mergeAll(
				Layer.succeed(AutomationExecutionOperations, operations),
				Layer.succeed(
					PgClient.PgClient,
					Object.assign(Object.create(null), { transactionService }),
				),
			),
		),
	);
const succeedingOperations = AutomationExecutionOperations.of({
	submit: () => Effect.void,
	skipQueuedPolicies: () => Effect.void,
	execute: ({ runId }) => Effect.succeed(result(runId)),
});
const policyPatch = { resource: "entity", draft: { name: "Changed" } } as const;

it.effect(
	"runs required hooks concurrently with all-settled warnings and discards async failures",
	() =>
		Effect.gen(function* () {
			const started = yield* Deferred.make<void>();
			let active = 0;
			const submissions: string[] = [];
			const runs = [run("success"), run("retry"), run("submission-failed"), run("async", "async")];
			const operations = AutomationExecutionOperations.of({
				skipQueuedPolicies: () => Effect.void,
				submit: ({ runId }) =>
					Effect.gen(function* () {
						submissions.push(runId);
						return yield* new DbError({ message: "async failure" });
					}),
				execute: ({ runId }) =>
					Effect.gen(function* () {
						active += 1;
						if (active === 3) {
							yield* Deferred.succeed(started, undefined);
						}
						yield* Deferred.await(started);
						if (runId === "submission-failed") {
							return yield* new DbError({ message: "offline" });
						}
						return result(runId, runId === "retry" ? "failed" : "succeeded");
					}),
			});
			const warnings = yield* Effect.flatMap(LifecycleExecution, (service) =>
				service.after({ runs, triggerId: trigger.id }),
			).pipe(Effect.provide(layer(operations)));
			expect(warnings).toEqual([
				{ runId: "retry", hookSlug: "retry", code: "required-hook-failed" },
				{
					runId: "submission-failed",
					code: "required-hook-pending",
					hookSlug: "submission-failed",
				},
			]);
			expect(submissions).toEqual(["async"]);
		}),
);

it.effect("bounds the whole fan-out by one deadline and never exceeds submission concurrency", () =>
	Effect.gen(function* () {
		let active = 0;
		let peak = 0;
		const asyncStarted = yield* Deferred.make<void>();
		const operations = AutomationExecutionOperations.of({
			skipQueuedPolicies: () => Effect.void,
			submit: () => Deferred.succeed(asyncStarted, undefined).pipe(Effect.asVoid),
			execute: () =>
				Effect.gen(function* () {
					active += 1;
					peak = Math.max(peak, active);
					return yield* Effect.never.pipe(
						Effect.ensuring(
							Effect.sync(() => {
								active -= 1;
							}),
						),
					);
				}),
		});
		const runs = Array.from({ length: AUTOMATION_IMMEDIATE_CONCURRENCY + 2 }, (_, i) =>
			run(`hook-${i}`),
		);
		const fiber = yield* Effect.flatMap(LifecycleExecution, (service) =>
			service.after({ triggerId: trigger.id, runs: [...runs, run("async", "async")] }),
		).pipe(Effect.provide(layer(operations)), Effect.forkChild);
		yield* Deferred.await(asyncStarted);
		yield* TestClock.adjust(Duration.millis(AUTOMATION_IMMEDIATE_TIMEOUT_MS));
		const warnings = yield* Fiber.join(fiber);
		expect(peak).toBe(AUTOMATION_IMMEDIATE_CONCURRENCY);
		expect(active).toBe(0);
		expect(warnings).toEqual(
			runs.map((planned) => ({
				runId: planned.id,
				hookSlug: planned.hookSlug,
				code: "required-hook-pending",
			})),
		);
	}),
);

it.effect("preserves durable suspension while waiting for a required hook", () =>
	Effect.gen(function* () {
		const operations = AutomationExecutionOperations.of({
			submit: () => Effect.void,
			execute: () => Effect.interrupt,
			skipQueuedPolicies: () => Effect.void,
		});
		const exit = yield* Effect.flatMap(LifecycleExecution, (service) =>
			service.after({ triggerId: trigger.id, runs: [run("required")] }),
		).pipe(Effect.provide(layer(operations)), Effect.exit);
		expect(exit._tag).toBe("Failure");
		if (exit._tag === "Failure") {
			expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true);
		}
	}),
);

it.effect("returns policy output and maps infrastructure failures to the stable run-ID error", () =>
	Effect.gen(function* () {
		const submitted: AutomationRunWorkflowPayload[] = [];
		const operations = AutomationExecutionOperations.of({
			submit: () => Effect.void,
			skipQueuedPolicies: () => Effect.void,
			execute: (payload) =>
				Effect.gen(function* () {
					submitted.push(payload);
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
		});
		yield* Effect.gen(function* () {
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
		}).pipe(Effect.provide(layer(operations)));
		expect(submitted).toEqual(
			["accepted", "failed", "db", "defect"].map((runId) => ({
				runId,
				attemptNumber: 1,
				acceptedPatches: runId === "accepted" ? [policyPatch] : [],
			})),
		);
	}),
);

it.effect("bounds policy waiting with the stable run-ID error and no later attempt", () =>
	Effect.gen(function* () {
		const submitted: AutomationRunWorkflowPayload[] = [];
		const runId = AutomationRunId.make("policy");
		const operations = AutomationExecutionOperations.of({
			submit: () => Effect.void,
			skipQueuedPolicies: () => Effect.void,
			execute: (payload) =>
				Effect.gen(function* () {
					submitted.push(payload);
					return yield* Effect.never;
				}),
		});
		const fiber = yield* Effect.flatMap(LifecycleExecution, (service) =>
			service.executePolicy({ runId, acceptedPatches: [policyPatch] }),
		).pipe(Effect.provide(layer(operations)), Effect.exit, Effect.forkChild);
		yield* TestClock.adjust(Duration.millis(AUTOMATION_IMMEDIATE_TIMEOUT_MS));
		assertExitFails(
			yield* Fiber.join(fiber),
			new AutomationPolicyExecutionError({ runId, code: "policy-execution-failed" }),
		);
		expect(submitted).toEqual([{ runId, attemptNumber: 1, acceptedPatches: [policyPatch] }]);
	}),
);

it.effect("submits deterministic workflow IDs and sets discard only for async delivery", () =>
	Effect.gen(function* () {
		const captured: Array<{
			executionId: string;
			discard: boolean;
			payload: AutomationRunWorkflowPayload;
		}> = [];
		const engine = makeWorkflowEngine({
			execute: (_workflow, options) =>
				Effect.gen(function* () {
					const payload = yield* Schema.decodeUnknownEffect(AutomationRunWorkflowPayload)(
						options.payload,
					);
					captured.push({
						payload,
						executionId: options.executionId,
						discard: options.discard === true,
					});
					return options.discard ? undefined : result(payload.runId);
				}),
		});
		yield* Effect.gen(function* () {
			const operations = yield* AutomationExecutionOperations;
			yield* operations.execute({
				attemptNumber: 1,
				acceptedPatches: [],
				runId: AutomationRunId.make("required"),
			});
			yield* operations.submit({
				attemptNumber: 1,
				acceptedPatches: [],
				runId: AutomationRunId.make("async"),
			});
		}).pipe(
			Effect.provide(
				AutomationExecutionOperationsLive.pipe(
					Layer.provide(
						Layer.mergeAll(
							Layer.succeed(WorkflowEngine, engine),
							AutomationRunRepository.layer,
							databaseLayer,
						),
					),
				),
			),
		);
		expect(captured).toEqual(
			["required", "async"].map((id) => ({
				discard: id === "async",
				payload: { runId: id, attemptNumber: 1, acceptedPatches: [] },
				executionId: automationAttemptIdentity(AutomationRunId.make(id), 1).workflowExecutionId,
			})),
		);
	}),
);

it.effect(
	"closes the abandoned trigger through the execution port and preserves cleanup DbError",
	() =>
		Effect.gen(function* () {
			const closed: string[] = [];
			const failure = new DbError({ message: "cleanup unavailable" });
			const operations = AutomationExecutionOperations.of({
				submit: () => Effect.die("unused"),
				execute: () => Effect.die("unused"),
				skipQueuedPolicies: ({ triggerId }) =>
					Effect.gen(function* () {
						closed.push(triggerId);
						if (closed.length === 2) {
							return yield* failure;
						}
						return undefined;
					}),
			});
			yield* Effect.gen(function* () {
				const service = yield* LifecycleExecution;
				yield* service.skipQueuedPolicies({ triggerId: trigger.id });
				assertExitFails(
					yield* Effect.exit(service.skipQueuedPolicies({ triggerId: trigger.id })),
					failure,
				);
			}).pipe(Effect.provide(layer(operations)));
			expect(closed).toEqual([trigger.id, trigger.id]);
		}),
);

it.effect("dispatches plans in order with blocked warnings and rejects an open transaction", () =>
	Effect.gen(function* () {
		const executed: string[] = [];
		const operations = AutomationExecutionOperations.of({
			submit: () => Effect.void,
			skipQueuedPolicies: () => Effect.void,
			execute: ({ runId }) =>
				Effect.sync(() => {
					executed.push(runId);
					return result(runId, "failed");
				}),
		});
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
		yield* Effect.gen(function* () {
			const service = yield* LifecycleExecution;
			expect(yield* service.dispatch(plans)).toEqual([
				{ runId: "first", hookSlug: "first", code: "required-hook-failed" },
				{ ...blockedReason, triggerId: trigger.id },
				{ runId: "second", hookSlug: "second", code: "required-hook-failed" },
			]);
			assertExitFails(
				yield* Effect.exit(
					service
						.dispatch(plans)
						.pipe(Effect.provideService(transactionService, [Object.create(null), 1])),
				),
				new LifecyclePersistenceError({ code: "postcommit-requires-root" }),
			);
		}).pipe(Effect.provide(layer(operations)));
		expect(executed).toEqual(["first", "second"]);
	}),
);

const expectActivityDefect = (exit: Exit.Exit<unknown, unknown>, operation: string) => {
	expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true);
	if (Exit.isFailure(exit)) {
		expect(Cause.pretty(exit.cause)).toContain(
			`LifecycleExecution.${operation} must run in a workflow body, not an activity`,
		);
	}
};

it.effect("rejects lifecycle execution inside activities", () =>
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
	}).pipe(Effect.provide(layer(succeedingOperations))),
);

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

it.effect("allows lifecycle execution in workflow bodies started from an activity", () =>
	Effect.gen(function* () {
		const service = yield* LifecycleExecution;
		const workflows = Layer.mergeAll(
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
		).pipe(Layer.provideMerge(workflowEngineTestLayer));
		expect(
			yield* GuardParentWorkflow.execute({ executionId: "guard-parent" }).pipe(
				Effect.provide(workflows),
			),
		).toBe(0);
	}).pipe(Effect.provide(layer(succeedingOperations))),
);
