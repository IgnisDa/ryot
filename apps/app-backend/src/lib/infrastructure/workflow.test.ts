import { expect, it } from "@effect/vitest";
import { Workflow } from "@effect/workflow";
import { WorkflowInstance } from "@effect/workflow/WorkflowEngine";
import { Effect, Option, Schema } from "effect";

import { makeWorkflowEngine } from "#lib/test-utils/effect";

import { detachDiscardedWorkflowChildren } from "./workflow";

const ChildWorkflow = Workflow.make({
	error: Schema.Never,
	success: Schema.Void,
	name: "DiscardedChildTestWorkflow",
	idempotencyKey: ({ executionId }) => executionId,
	payload: Schema.Struct({ executionId: Schema.String }),
});

it.effect("detaches discarded children while preserving awaited child parent linkage", () => {
	const observedParents: boolean[] = [];
	const engine = detachDiscardedWorkflowChildren(
		makeWorkflowEngine({
			execute: () =>
				Effect.serviceOption(WorkflowInstance).pipe(
					Effect.tap((parent) =>
						Effect.sync(() => {
							observedParents.push(Option.isSome(parent));
						}),
					),
					Effect.as(undefined),
				),
		}),
	);
	const parent = WorkflowInstance.initial(ChildWorkflow, "parent");

	return Effect.gen(function* () {
		yield* engine.execute(ChildWorkflow, {
			discard: true,
			executionId: "discarded",
			payload: { executionId: "discarded" },
		});
		yield* engine.execute(ChildWorkflow, {
			executionId: "awaited",
			payload: { executionId: "awaited" },
		});

		expect(observedParents).toEqual([false, true]);
	}).pipe(Effect.provideService(WorkflowInstance, parent));
});
