import { expect, layer } from "@effect/vitest";
import { AutomationWarning } from "@ryot-app/contract/modules/automations/lifecycle";
import { AutomationRunId } from "@ryot-app/contract/schema/brands";
import { Cause, Effect, Exit, Fiber, Layer, Option, Ref, Schema } from "effect";
import { TestClock } from "effect/testing";
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

import { AutomationAttemptRepository } from "./attempt-repository";
import {
	AUTOMATION_IMMEDIATE_TIMEOUT_MS,
	AutomationExecutionOperations,
	AutomationExecutionOperationsLive,
	AutomationObservationWorkflowDefinitionsLive,
	LifecycleExecutionLive,
} from "./execution";
import { triggerFixture, queuedRunFixture } from "./lifecycle.test-support";
import {
	executionIdOf,
	operationsLive,
	policyOutput,
	policyPatch,
	release,
	RunControl,
	runControlLayer,
	runWorkflowLive,
} from "./observation.test-support";
import { AutomationRunRepository } from "./run-repository";
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
const ObservationParent = Workflow.make("LifecycleObservationParent", {
	idempotencyKey: ({ id }) => id,
	success: Schema.Array(AutomationWarning),
	payload: { id: Schema.String, holdMs: Schema.Finite, runs: Schema.Array(Schema.String) },
});

const parentLive = Layer.unwrap(
	Effect.map(LifecycleExecution, (service) =>
		implementWorkflow(ObservationParent, ({ runs, holdMs, id: parentId }) =>
			Effect.gen(function* () {
				yield* Ref.update((yield* RunControl).parentStarts, (all) =>
					new Map(all).set(parentId, (all.get(parentId) ?? 0) + 1),
				);
				const warnings = yield* service
					.after({ triggerId: trigger.id, runs: runs.map((id) => run(id)) })
					.pipe(Effect.orDie);
				yield* Effect.sleep(holdMs);
				return warnings;
			}),
		),
	),
);

const executionLayer = Layer.mergeAll(
	parentLive,
	runWorkflowLive,
	AutomationObservationWorkflowDefinitionsLive,
).pipe(
	Layer.provideMerge(
		LifecycleExecutionLive.pipe(
			Layer.provide(
				Layer.unwrap(
					Effect.map(RunControl, (control) =>
						Layer.mock(DatabaseSession)({
							requireRoot: Effect.flatMap(Ref.get(control.transactionActive), (active) =>
								active
									? Effect.fail(
											new DatabaseSessionStateError({ reason: "transaction-already-active" }),
										)
									: Effect.void,
							),
						}),
					),
				),
			),
		),
	),
	Layer.provideMerge(operationsLive),
	Layer.provideMerge(workflowEngineTestLayer),
	Layer.provideMerge(runControlLayer(AUTOMATION_IMMEDIATE_TIMEOUT_MS + 1_000)),
);

const settled = <A, E>(fiber: Fiber.Fiber<A, E>) =>
	Effect.gen(function* () {
		for (let index = 0; index < 50 && fiber.pollUnsafe() === undefined; index += 1) {
			yield* Effect.yieldNow;
		}
		return fiber.pollUnsafe();
	});

// Outside a workflow instance the engine re-checks a suspended observer every 50 ms, so one step of
// that length must deliver an outcome that is already decided.
const outside = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
	Effect.gen(function* () {
		const fiber = yield* Effect.forkChild(effect);
		yield* TestClock.adjust(50);
		yield* settled(fiber);
		return fiber;
	});
const passDeadline = <A, E>(fiber: Fiber.Fiber<A, E>) =>
	TestClock.adjust(AUTOMATION_IMMEDIATE_TIMEOUT_MS).pipe(Effect.andThen(outsideRecheck(fiber)));
const outsideRecheck = <A, E>(fiber: Fiber.Fiber<A, E>) =>
	TestClock.adjust(50).pipe(Effect.andThen(settled(fiber)));

const startParent = (id: string, runs: ReadonlyArray<string>, holdMs = 0) =>
	Effect.flatMap(WorkflowEngine, (engine) =>
		engine.execute(ObservationParent, {
			discard: true,
			executionId: id,
			payload: { id, runs, holdMs },
		}),
	);
const parentResult = (id: string) =>
	Effect.gen(function* () {
		const engine = yield* WorkflowEngine;
		for (let index = 0; index < 50; index += 1) {
			const polled = Option.getOrUndefined(yield* engine.poll(ObservationParent, id));
			if (polled?._tag === "Complete") {
				return polled.exit;
			}
			yield* Effect.yieldNow;
		}
		return undefined;
	});
const parentStarts = (id: string) =>
	Effect.map(RunControl, (control) => control.parentStarts).pipe(
		Effect.flatMap(Ref.get),
		Effect.map((all) => all.get(id) ?? 0),
	);
const ownRuns = (submitted: ReadonlyArray<string>, runIds: ReadonlyArray<string>) =>
	runIds.filter((id) => submitted.includes(id));

layer(executionLayer)((test) => {
	test.effect(
		"settles required hooks after one re-check outside a workflow and never awaits async hooks",
		() =>
			Effect.gen(function* () {
				const service = yield* LifecycleExecution;
				const fiber = yield* outside(
					service.after({
						triggerId: trigger.id,
						runs: [
							run("success"),
							run("retry-failed"),
							run("submission-failed"),
							run("held-async", "async"),
							run("submission-failed-async", "async"),
						],
					}),
				);
				expect(fiber.pollUnsafe()).toEqual(
					Exit.succeed([
						{ runId: "retry-failed", hookSlug: "retry-failed", code: "required-hook-failed" },
						{
							runId: "submission-failed",
							hookSlug: "submission-failed",
							code: "required-hook-pending",
						},
					]),
				);
				expect(
					(yield* Ref.get((yield* RunControl).submitted)).filter((id) => id.includes("async")),
				).toEqual(["held-async", "submission-failed-async"]);
			}),
	);

	test.effect(
		"records a pending hook at the deadline and keeps that outcome after it completes",
		() =>
			Effect.gen(function* () {
				const service = yield* LifecycleExecution;
				const after = service.after({ triggerId: trigger.id, runs: [run("held-deadline")] });
				const fiber = yield* outside(after);
				expect(fiber.pollUnsafe()).toBeUndefined();
				const pending = Exit.succeed([
					{ runId: "held-deadline", hookSlug: "held-deadline", code: "required-hook-pending" },
				]);
				expect(yield* passDeadline(fiber)).toEqual(pending);
				yield* release("held-deadline");
				expect((yield* outside(after)).pollUnsafe()).toEqual(pending);
			}),
	);

	test.effect(
		"counts an attempt that finished before the deadline even when its run exits after it",
		() =>
			Effect.gen(function* () {
				const service = yield* LifecycleExecution;
				const fiber = yield* outside(
					service.after({ triggerId: trigger.id, runs: [run("late-success")] }),
				);
				expect(yield* passDeadline(fiber)).toEqual(Exit.succeed([]));
			}),
	);

	test.effect(
		"resumes a waiting workflow when each required hook completes, without advancing the clock",
		() =>
			Effect.gen(function* () {
				const control = yield* RunControl;
				yield* startParent("wake", ["held-first", "held-second"]);
				expect(yield* parentResult("wake")).toBeUndefined();
				expect(ownRuns(yield* Ref.get(control.submitted), ["held-first", "held-second"])).toEqual([
					"held-first",
					"held-second",
				]);
				const starts = yield* parentStarts("wake");
				yield* release("held-second");
				expect(yield* parentResult("wake")).toBeUndefined();
				expect(yield* parentStarts("wake")).toBeGreaterThan(starts);
				yield* release("held-first");
				expect(yield* parentResult("wake")).toEqual(Exit.succeed([]));
			}),
	);

	test.effect("does not replay a running workflow when an observer's deadline passes later", () =>
		Effect.gen(function* () {
			yield* startParent(
				"no-spurious-wake",
				["success-before-deadline"],
				2 * AUTOMATION_IMMEDIATE_TIMEOUT_MS,
			);
			expect(yield* parentResult("no-spurious-wake")).toBeUndefined();
			const starts = yield* parentStarts("no-spurious-wake");
			yield* TestClock.adjust(AUTOMATION_IMMEDIATE_TIMEOUT_MS + 1_000);
			expect(yield* parentStarts("no-spurious-wake")).toBe(starts);
			yield* TestClock.adjust(AUTOMATION_IMMEDIATE_TIMEOUT_MS);
			expect(yield* parentResult("no-spurious-wake")).toEqual(Exit.succeed([]));
			expect(yield* parentStarts("no-spurious-wake")).toBe(starts);
		}),
	);

	test.effect("returns policy output only for a policy that succeeds before the deadline", () =>
		Effect.gen(function* () {
			const service = yield* LifecycleExecution;
			const policy = (runId: string) =>
				service.executePolicy({
					acceptedPatches: [policyPatch],
					runId: AutomationRunId.make(runId),
				});
			expect((yield* outside(policy("policy-accepted"))).pollUnsafe()).toEqual(
				Exit.succeed(policyOutput),
			);
			for (const runId of ["policy-failed", "submission-failed-policy"]) {
				assertExitFails(
					yield* Fiber.await(yield* outside(policy(runId))),
					new AutomationPolicyExecutionError({
						code: "policy-execution-failed",
						runId: AutomationRunId.make(runId),
					}),
				);
			}
			const held = yield* outside(policy("held-policy"));
			yield* passDeadline(held);
			assertExitFails(
				yield* Fiber.await(held),
				new AutomationPolicyExecutionError({
					code: "policy-execution-failed",
					runId: AutomationRunId.make("held-policy"),
				}),
			);
		}),
	);

	test.effect(
		"dispatches plans in order with blocked warnings and rejects an open transaction",
		() =>
			Effect.gen(function* () {
				const control = yield* RunControl;
				const blockedReason = {
					omittedHooks: [],
					hasRequiredHooks: true,
					code: "automation-limit-reached" as const,
				};
				const plans: ReadonlyArray<LifecycleDispatchPlan> = [
					{ blockedReason: null, triggerId: trigger.id, runs: [run("first-failed")] },
					{ blockedReason, triggerId: trigger.id, runs: [run("second-failed")] },
				];
				const service = yield* LifecycleExecution;
				expect((yield* outside(service.dispatch(plans))).pollUnsafe()).toEqual(
					Exit.succeed([
						{ runId: "first-failed", hookSlug: "first-failed", code: "required-hook-failed" },
						{ ...blockedReason, triggerId: trigger.id },
						{ runId: "second-failed", hookSlug: "second-failed", code: "required-hook-failed" },
					]),
				);
				yield* Ref.set(control.transactionActive, true);
				assertExitFails(
					yield* Effect.exit(service.dispatch(plans)),
					new LifecyclePersistenceError({ code: "postcommit-requires-root" }),
				);
			}),
	);

	test.effect("closes an abandoned trigger through the execution port", () =>
		Effect.gen(function* () {
			yield* (yield* LifecycleExecution).skipQueuedPolicies({ triggerId: trigger.id });
			expect(yield* Ref.get((yield* RunControl).skipped)).toEqual([trigger.id]);
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
		Layer.provide(AutomationAttemptRepository.layer),
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
					executionId: executionIdOf(id),
					payload: { runId: id, attemptNumber: 1, acceptedPatches: [] },
				})),
			);
		}),
	);
});

const expectActivityDefect = (exit: Exit.Exit<unknown, unknown>, operation: string) => {
	expect(
		Exit.isFailure(exit)
			? exit.cause.reasons.filter(Cause.isDieReason).map(({ defect }) => defect)
			: [],
	).toEqual([`LifecycleExecution.${operation} must run in a workflow body, not an activity`]);
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

const guardWorkflowsLayer = Layer.unwrap(
	Effect.map(LifecycleExecution, (service) =>
		Layer.mergeAll(
			implementWorkflow(GuardChildWorkflow, () =>
				service.after({ triggerId: trigger.id, runs: [run("guard-hook")] }).pipe(
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
).pipe(Layer.provideMerge(executionLayer));

layer(guardWorkflowsLayer)((test) => {
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
		}),
	);

	test.effect("allows lifecycle execution in workflow bodies started from an activity", () =>
		Effect.gen(function* () {
			expect(yield* GuardParentWorkflow.execute({ executionId: "guard-parent" })).toBe(0);
		}),
	);
});
