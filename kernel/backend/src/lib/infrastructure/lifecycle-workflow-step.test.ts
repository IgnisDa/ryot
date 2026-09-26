import { expect, it } from "@effect/vitest";
import { Effect, Layer, Schema } from "effect";
import { Workflow } from "effect/unstable/workflow";
import { WorkflowEngine, WorkflowInstance } from "effect/unstable/workflow/WorkflowEngine";

import { LifecycleExecution } from "#lib/domain/lifecycle-execution";
import { assertExitFails } from "#lib/test-utils/assertions";
import { makeMemoizingWorkflowEngine } from "#lib/test-utils/effect";

import { runLifecycleWriteStep, type LifecyclePreparedStep } from "./lifecycle-workflow-step";

class StepFailure extends Schema.TaggedError<StepFailure>()("StepFailure", {
	message: Schema.String,
}) {}

const Pending = Schema.Struct({ draft: Schema.String });
const Result = Schema.Struct({ committed: Schema.String });

const StepWorkflow = Workflow.make("LifecycleWriteStepTestWorkflow", {
	success: Schema.Void,
	payload: { executionId: Schema.String },
	idempotencyKey: ({ executionId }) => executionId,
});

const execution = Layer.succeed(LifecycleExecution, {
	dispatch: () => Effect.succeed([]),
	after: () => Effect.die("unexpected after"),
	executePolicy: () => Effect.die("unexpected policy"),
	skipQueuedPolicies: () => Effect.die("unexpected policy skip"),
});

it.effect("keeps the recorded policy rejection across body replays and never commits", () => {
	const activityRuns: string[] = [];
	const policyAttempts: string[] = [];
	const instance = WorkflowInstance.initial(StepWorkflow, "policy-outcome");
	const step = runLifecycleWriteStep({
		result: Result,
		pending: Pending,
		error: StepFailure,
		name: "write-record",
		prepare: Effect.succeed({
			_tag: "PoliciesRequired",
			pending: { draft: "first" },
		} satisfies LifecyclePreparedStep<typeof Result.Type, typeof Pending.Type>),
		commit: (pending) =>
			Effect.succeed({
				dispatch: [],
				_tag: "Committed",
				result: { committed: pending.draft },
			} satisfies LifecyclePreparedStep<typeof Result.Type, typeof Pending.Type>),
		applyPolicies: (pending) =>
			Effect.suspend(() => {
				policyAttempts.push(pending.draft);
				return policyAttempts.length === 1
					? Effect.fail(new StepFailure({ message: "policy timed out" }))
					: Effect.succeed(pending);
			}),
	}).pipe(
		Effect.provideService(WorkflowInstance, instance),
		Effect.provideService(WorkflowEngine, makeMemoizingWorkflowEngine(instance, activityRuns)),
	);

	return Effect.gen(function* () {
		const failure = new StepFailure({ message: "policy timed out" });
		assertExitFails(yield* Effect.exit(step), failure);
		assertExitFails(yield* Effect.exit(step), failure);
		expect(policyAttempts).toEqual(["first", "first"]);
		expect(activityRuns).toEqual(["write-record:prepare", "write-record:policy-outcome"]);
	}).pipe(Effect.provide(execution));
});

it.effect("commits and dispatches once policies accept the pending write", () => {
	const activityRuns: string[] = [];
	const dispatched: string[] = [];
	const instance = WorkflowInstance.initial(StepWorkflow, "policy-accepted");
	const step = runLifecycleWriteStep({
		result: Result,
		pending: Pending,
		error: StepFailure,
		name: "write-record",
		applyPolicies: (pending) => Effect.succeed({ draft: `${pending.draft}-transformed` }),
		prepare: Effect.succeed({
			_tag: "PoliciesRequired",
			pending: { draft: "first" },
		} satisfies LifecyclePreparedStep<typeof Result.Type, typeof Pending.Type>),
		commit: (pending) =>
			Effect.succeed({
				dispatch: [],
				_tag: "Committed",
				result: { committed: pending.draft },
			} satisfies LifecyclePreparedStep<typeof Result.Type, typeof Pending.Type>),
	}).pipe(
		Effect.provideService(WorkflowInstance, instance),
		Effect.provideService(WorkflowEngine, makeMemoizingWorkflowEngine(instance, activityRuns)),
	);

	return Effect.gen(function* () {
		expect(yield* step).toEqual({ warnings: [], result: { committed: "first-transformed" } });
		expect(activityRuns).toEqual([
			"write-record:prepare",
			"write-record:policy-outcome",
			"write-record:commit",
		]);
	}).pipe(
		Effect.provideService(LifecycleExecution, {
			after: () => Effect.die("unexpected after"),
			executePolicy: () => Effect.die("unexpected policy"),
			skipQueuedPolicies: () => Effect.die("unexpected policy skip"),
			dispatch: (plans) =>
				Effect.sync(() => {
					dispatched.push(...plans.map(({ triggerId }) => triggerId));
					return [];
				}),
		}),
	);
});
