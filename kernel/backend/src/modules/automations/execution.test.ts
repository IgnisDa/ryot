import { expect, layer } from "@effect/vitest";
import { AutomationWarning } from "@ryot-app/contract/modules/automations/lifecycle";
import { AutomationRunId } from "@ryot-app/contract/schema/brands";
import { Cause, Effect, Exit, Fiber, Layer, Option, Ref, Schema } from "effect";
import { TestClock } from "effect/testing";
import { DurableDeferred, Workflow } from "effect/workflow";
import { WorkflowEngine, WorkflowInstance } from "effect/workflow/WorkflowEngine";

import { LifecyclePersistenceError, type LifecycleDispatchPlan } from "#lib/domain/lifecycle";
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
	LifecycleExecutionLive,
} from "./execution";
import { triggerFixture, queuedRunFixture } from "./lifecycle.test-support";
import {
	executionIdOf,
	operationsLive,
	policyOutput,
	policyPatch,
	release,
	requiredRun,
	RunControl,
	runControlLayer,
	runWorkflowLive,
} from "./required-hooks.test-support";
import { AutomationRunRepository } from "./run-repository";
import { AutomationRunWorkflow } from "./run-workflow";
import {
	RunWorkflowSubmissions,
	recordingRunWorkflowEngineLayer,
} from "./run-workflow-engine.test-support";

const trigger = triggerFixture();
const laterTrigger = triggerFixture("trigger-later");
const run = (id: string, delivery: "required" | "async" = "required", triggerId = trigger.id) =>
	requiredRun(id, triggerId, delivery);
const ParentWorkflow = Workflow.make("LifecycleRequiredHooksParent", {
	idempotencyKey: ({ id }) => id,
	success: Schema.Array(AutomationWarning),
	payload: {
		id: Schema.String,
		gated: Schema.Boolean,
		holdMs: Schema.Finite,
		runs: Schema.Array(Schema.String),
		laterRuns: Schema.Array(Schema.String),
	},
});
const Gate = DurableDeferred.make("gate", { success: Schema.Void });

const parentLive = Layer.unwrap(
	Effect.map(LifecycleExecution, (service) =>
		implementWorkflow(ParentWorkflow, ({ runs, gated, holdMs, laterRuns, id: parentId }) =>
			Effect.gen(function* () {
				yield* Ref.update((yield* RunControl).parentStarts, (all) =>
					new Map(all).set(parentId, (all.get(parentId) ?? 0) + 1),
				);
				const warnings = yield* service
					.after({ triggerId: trigger.id, runs: runs.map((id) => run(id)) })
					.pipe(Effect.orDie);
				const laterWarnings =
					laterRuns.length === 0
						? []
						: yield* service
								.after({
									triggerId: laterTrigger.id,
									runs: laterRuns.map((id) => run(id, "required", laterTrigger.id)),
								})
								.pipe(Effect.orDie);
				if (gated) {
					yield* DurableDeferred.await(Gate);
				}
				yield* Effect.sleep(holdMs);
				return [...warnings, ...laterWarnings];
			}),
		),
	),
);

const executionLayer = Layer.mergeAll(parentLive, runWorkflowLive).pipe(
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

// Outside a workflow instance the caller re-reads unsettled attempts every 50 ms, so one step of that
// length must deliver an outcome that is already decided.
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

const startParent = (
	id: string,
	runs: ReadonlyArray<string>,
	options: { gated?: boolean; holdMs?: number; laterRuns?: ReadonlyArray<string> } = {},
) =>
	Effect.flatMap(WorkflowEngine, (engine) =>
		engine.execute(ParentWorkflow, {
			discard: true,
			executionId: id,
			payload: {
				id,
				runs,
				holdMs: options.holdMs ?? 0,
				gated: options.gated ?? false,
				laterRuns: options.laterRuns ?? [],
			},
		}),
	);
const openGate = (id: string) =>
	DurableDeferred.succeed(Gate, {
		value: undefined,
		token: DurableDeferred.tokenFromExecutionId(Gate, {
			executionId: id,
			workflow: ParentWorkflow,
		}),
	});
const parentResult = (id: string) =>
	Effect.gen(function* () {
		const engine = yield* WorkflowEngine;
		for (let index = 0; index < 50; index += 1) {
			const polled = Option.getOrUndefined(yield* engine.poll(ParentWorkflow, id));
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

const pendingWarning = (runId: string) => ({
	runId,
	hookSlug: runId,
	code: "required-hook-pending" as const,
});
const submissions = (runId: string) =>
	Effect.map(RunControl, (control) => control.submitted).pipe(
		Effect.flatMap(Ref.get),
		Effect.map((all) => all.filter((id) => id === runId).length),
	);
const runExists = (runId: string) =>
	Effect.flatMap(WorkflowEngine, (engine) =>
		engine.poll(AutomationRunWorkflow.interactive, executionIdOf(runId)),
	).pipe(Effect.map(Option.isSome));

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
							run("skipped-outside"),
							run("held-async", "async"),
							run("submission-failed-async", "async"),
						],
					}),
				);
				expect(fiber.pollUnsafe()).toEqual(
					Exit.succeed([
						{ runId: "retry-failed", hookSlug: "retry-failed", code: "required-hook-failed" },
						pendingWarning("submission-failed"),
						pendingWarning("skipped-outside"),
					]),
				);
				const submitted = yield* Ref.get((yield* RunControl).submitted);
				expect(submitted.filter((id) => id.includes("async"))).toEqual([
					"held-async",
					"submission-failed-async",
				]);
				expect(submitted).not.toContain("skipped-outside");
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
		"resumes a waiting workflow when each required hook completes and submits each hook once",
		() =>
			Effect.gen(function* () {
				yield* startParent("wake", ["held-first", "held-second"]);
				expect(yield* parentResult("wake")).toBeUndefined();
				const starts = yield* parentStarts("wake");
				yield* release("held-second");
				expect(yield* parentResult("wake")).toBeUndefined();
				expect(yield* parentStarts("wake")).toBeGreaterThan(starts);
				yield* release("held-first");
				expect(yield* parentResult("wake")).toEqual(Exit.succeed([]));
				expect([yield* submissions("held-first"), yield* submissions("held-second")]).toEqual([
					1, 1,
				]);
			}),
	);

	test.effect("records a pending hook at the deadline and keeps that outcome on replay", () =>
		Effect.gen(function* () {
			yield* startParent("deadline", ["held-deadline"], { gated: true });
			yield* TestClock.adjust(AUTOMATION_IMMEDIATE_TIMEOUT_MS);
			yield* release("held-deadline");
			const starts = yield* parentStarts("deadline");
			yield* openGate("deadline");
			expect(yield* parentResult("deadline")).toEqual(
				Exit.succeed([pendingWarning("held-deadline")]),
			);
			expect(yield* parentStarts("deadline")).toBeGreaterThan(starts);
		}),
	);

	test.effect("counts a hook whose attempt finished before the deadline it lost the race to", () =>
		Effect.gen(function* () {
			yield* startParent("late-exit", ["late-in-workflow"]);
			yield* TestClock.adjust(AUTOMATION_IMMEDIATE_TIMEOUT_MS);
			expect(yield* parentResult("late-exit")).toEqual(Exit.succeed([]));
		}),
	);

	test.effect("does not replay a running workflow when its hook deadline passes later", () =>
		Effect.gen(function* () {
			yield* startParent("no-spurious-wake", ["success-before-deadline"], {
				holdMs: 2 * AUTOMATION_IMMEDIATE_TIMEOUT_MS,
			});
			expect(yield* parentResult("no-spurious-wake")).toBeUndefined();
			const starts = yield* parentStarts("no-spurious-wake");
			yield* TestClock.adjust(AUTOMATION_IMMEDIATE_TIMEOUT_MS + 1_000);
			expect(yield* parentStarts("no-spurious-wake")).toBe(starts);
			yield* TestClock.adjust(AUTOMATION_IMMEDIATE_TIMEOUT_MS);
			expect(yield* parentResult("no-spurious-wake")).toEqual(Exit.succeed([]));
			expect(yield* parentStarts("no-spurious-wake")).toBe(starts);
		}),
	);

	test.effect("never starts a hook whose submission failed or was closed before it", () =>
		Effect.gen(function* () {
			yield* startParent("unsubmitted", ["submission-failed-wf", "skipped-wf", "success-wf"]);
			expect(yield* parentResult("unsubmitted")).toEqual(
				Exit.succeed([pendingWarning("submission-failed-wf"), pendingWarning("skipped-wf")]),
			);
			expect([
				yield* runExists("submission-failed-wf"),
				yield* runExists("skipped-wf"),
				yield* runExists("success-wf"),
			]).toEqual([false, false, true]);
			expect(yield* submissions("skipped-wf")).toBe(0);
		}),
	);

	test.effect("gives each wait in one workflow its own deadline", () =>
		Effect.gen(function* () {
			yield* startParent("two-waits", ["held-two-waits"], { laterRuns: ["success-later"] });
			yield* TestClock.adjust(AUTOMATION_IMMEDIATE_TIMEOUT_MS);
			expect(yield* parentResult("two-waits")).toEqual(
				Exit.succeed([pendingWarning("held-two-waits")]),
			);
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
			for (const runId of ["policy-failed", "submission-failed-policy", "skipped-policy"]) {
				assertExitFails(
					yield* Fiber.await(yield* outside(policy(runId))),
					new AutomationPolicyExecutionError({
						code: "policy-execution-failed",
						runId: AutomationRunId.make(runId),
					}),
				);
			}
			expect(yield* submissions("skipped-policy")).toBe(0);
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
				expect(yield* outsideRecheck(yield* outside(service.dispatch(plans)))).toEqual(
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
				listDispatchStates: (ids) =>
					Effect.succeed(
						(
							[
								{ id: "claimed", attemptCount: 1, status: "running", lane: "interactive" },
								{ id: "retried", attemptCount: 1, status: "queued", lane: "background" },
								{ id: "fresh", attemptCount: 0, status: "queued", lane: "interactive" },
								{ id: "skipped", attemptCount: 0, status: "skipped", lane: "background" },
								{ id: "required", attemptCount: 0, status: "queued", lane: "interactive" },
								{ id: "async", attemptCount: 0, status: "queued", lane: "background" },
							] as const
						).filter(({ id }) => ids.includes(AutomationRunId.make(id))),
					),
			}),
		),
		Layer.provide(AutomationAttemptRepository.layer),
		Layer.provideMerge(databaseLayer),
		Layer.provideMerge(recordingRunWorkflowEngineLayer()),
	),
)((test) => {
	test.effect("only treats runs that were never claimed and are still queued as unsubmitted", () =>
		Effect.gen(function* () {
			const runIds = ["claimed", "retried", "fresh", "skipped", "missing"].map((id) =>
				AutomationRunId.make(id),
			);
			const states = yield* (yield* AutomationExecutionOperations).dispatchStates(runIds);
			expect(runIds.map((id) => states.get(id))).toEqual([
				{ state: "claimed", lane: "interactive" },
				{ state: "claimed", lane: "background" },
				{ state: "fresh", lane: "interactive" },
				{ state: "closed", lane: "background" },
				{ state: "closed", lane: "background" },
			]);
		}),
	);

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
				(
					[
						["required", "AutomationRunWorkflowInteractive"],
						["async", "AutomationRunWorkflow"],
					] as const
				).map(([id, workflowName]) => ({
					workflowName,
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
