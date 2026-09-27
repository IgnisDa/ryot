import { Effect, Option, Schema } from "effect";
import { Workflow } from "effect/workflow";
import { WorkflowEngine } from "effect/workflow/WorkflowEngine";

export const interruptWorkflowAndWait = Effect.fn("workflow.interruptAndWait")(function* (
	workflow: Workflow.Any,
	executionId: string,
) {
	const engine = yield* WorkflowEngine;
	const completion = Workflow.make(workflow._tag, {
		error: Schema.Unknown,
		success: Schema.Unknown,
		payload: Schema.Struct({}),
		idempotencyKey: () => executionId,
	});
	yield* engine.interrupt(workflow, executionId);
	let result = yield* engine.poll(completion, executionId);
	while (Option.isSome(result) && result.value._tag !== "Complete") {
		yield* Effect.sleep("100 millis");
		result = yield* engine.poll(completion, executionId);
	}
});
