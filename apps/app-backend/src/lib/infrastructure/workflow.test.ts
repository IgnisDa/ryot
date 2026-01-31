import { expect, it } from "@effect/vitest";
import { Effect, Layer, Option, Schema } from "effect";
import { Workflow } from "effect/unstable/workflow";
import { WorkflowInstance } from "effect/unstable/workflow/WorkflowEngine";

import { makeWorkflowEngine, workflowEngineTestLayer } from "#lib/test-utils/effect";

import { detachDiscardedWorkflowChildren } from "./workflow";

const ChildWorkflow = Workflow.make("DiscardedChildTestWorkflow", {
	error: Schema.Never,
	success: Schema.Void,
	payload: { executionId: Schema.String },
	idempotencyKey: ({ executionId }) => executionId,
});

const ChildWorkflowLayer = ChildWorkflow.toLayer(() => Effect.void).pipe(
	Layer.provideMerge(workflowEngineTestLayer),
);

it.effect("provides an in-memory workflow test runtime", () =>
	ChildWorkflow.execute({ executionId: "memory" }).pipe(Effect.provide(ChildWorkflowLayer)),
);

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
