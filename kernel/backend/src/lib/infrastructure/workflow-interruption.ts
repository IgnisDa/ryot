import { Effect, Option, Schema } from "effect";
import { DurableDeferred, Workflow } from "effect/workflow";
import { WorkflowEngine } from "effect/workflow/WorkflowEngine";

import { awaitWorkflowSettled } from "./workflow-execution-notifications";

// The cluster engine records `interrupt` under this deferred and applies it only once a run
// suspends, so work that never suspends must look for it.
const interruptSignal = DurableDeferred.make("Workflow/InterruptSignal");

export const workflowInterruptRequested = Effect.flatMap(WorkflowEngine, (engine) =>
	engine.deferredResult(interruptSignal),
).pipe(Effect.map(Option.isSome));

export const interruptWorkflowAndWait = Effect.fn("workflow.interruptAndWait")(function* (
	workflow: Workflow.Any,
	executionId: string,
	options: { readonly requireReply?: boolean } = {},
) {
	const engine = yield* WorkflowEngine;
	const completion = Workflow.make(workflow._tag, {
		error: Schema.Unknown,
		success: Schema.Unknown,
		payload: Schema.Struct({}),
		annotations: workflow.annotations,
		idempotencyKey: () => executionId,
	});
	yield* engine.interrupt(workflow, executionId);
	yield* awaitWorkflowSettled({
		backstop: "1 second",
		read: engine.poll(completion, executionId),
		identities: [{ executionId, workflowName: workflow._tag }],
		isSettled: (result) =>
			Option.isSome(result) ? result.value._tag === "Complete" : options.requireReply !== true,
	});
});
