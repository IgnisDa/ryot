import { it } from "@effect/vitest";
import { Effect, Layer, Schema } from "effect";
import { Workflow } from "effect/unstable/workflow";

import { implementWorkflow } from "#lib/infrastructure/workflow-scope";
import { workflowEngineTestLayer } from "#lib/test-utils/effect";

const ChildWorkflow = Workflow.make("DiscardedChildTestWorkflow", {
	error: Schema.Never,
	success: Schema.Void,
	payload: { executionId: Schema.String },
	idempotencyKey: ({ executionId }) => executionId,
});

const ChildWorkflowLayer = implementWorkflow(ChildWorkflow, () => Effect.void).pipe(
	Layer.provideMerge(workflowEngineTestLayer),
);

it.effect("provides an in-memory workflow test runtime", () =>
	ChildWorkflow.execute({ executionId: "memory" }).pipe(Effect.provide(ChildWorkflowLayer)),
);
