import { layer } from "@effect/vitest";
import { Effect, Layer, Schema } from "effect";
import { Workflow } from "effect/workflow";

import { implementWorkflow } from "#platform/workflow/scope";
import { workflowEngineTestLayer } from "#testing/effect";

const ChildWorkflow = Workflow.make("DiscardedChildTestWorkflow", {
	error: Schema.Never,
	success: Schema.Void,
	payload: { executionId: Schema.String },
	idempotencyKey: ({ executionId }) => executionId,
});

const ChildWorkflowLayer = implementWorkflow(ChildWorkflow, () => Effect.void).pipe(
	Layer.provideMerge(workflowEngineTestLayer),
);

layer(ChildWorkflowLayer)((test) => {
	test.effect("provides an in-memory workflow test runtime", () =>
		ChildWorkflow.execute({ executionId: "memory" }),
	);
});
