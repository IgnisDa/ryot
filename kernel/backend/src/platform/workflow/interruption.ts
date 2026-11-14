import { Effect, Option, Schema } from "effect";
import { DurableDeferred, Workflow } from "effect/workflow";
import { WorkflowEngine } from "effect/workflow/WorkflowEngine";

import { awaitWorkflowSettled } from "./execution-notifications";
import type { WorkflowIdentity } from "./identity";
import { makeWorkflowCodecs, WorkflowCodecs } from "./scope";

// The engine records `interrupt` under this deferred and applies it only once a run
// suspends, so work that never suspends must look for it.
const interruptSignal = DurableDeferred.make("Workflow/InterruptSignal");

export const workflowInterruptRequested = Effect.flatMap(WorkflowEngine, (engine) =>
	engine.deferredResult(interruptSignal),
).pipe(Effect.map(Option.isSome));

// Reads only the completion state, so it decodes without the workflow being registered here.
const completionWorkflow = (workflow: Workflow.Any, executionId: string) => {
	const completion = Workflow.make(workflow._tag, {
		error: Schema.Unknown,
		success: Schema.Unknown,
		payload: Schema.Struct({}),
		annotations: workflow.annotations,
		idempotencyKey: () => executionId,
	});
	return completion.annotate(WorkflowCodecs, makeWorkflowCodecs(completion));
};

// An execution known only by name, whose workflow may not be registered in this process.
const namedWorkflow = (identity: WorkflowIdentity) =>
	Workflow.make(identity.workflowName, {
		error: Schema.Unknown,
		success: Schema.Unknown,
		payload: Schema.Struct({}),
		idempotencyKey: () => identity.executionId,
	});

export const isExecutionSettled = Effect.fn("workflow.isSettled")(function* (
	identity: WorkflowIdentity,
) {
	const result = yield* (yield* WorkflowEngine).poll(
		completionWorkflow(namedWorkflow(identity), identity.executionId),
		identity.executionId,
	);
	return Option.isSome(result) && result.value._tag === "Complete";
});

export const interruptWorkflowAndWait = Effect.fn("workflow.interruptAndWait")(function* (
	workflow: Workflow.Any,
	executionId: string,
	options: { readonly requireReply?: boolean } = {},
) {
	const engine = yield* WorkflowEngine;
	const completion = completionWorkflow(workflow, executionId);
	yield* engine.interrupt(workflow, executionId);
	yield* awaitWorkflowSettled({
		backstop: "1 second",
		read: engine.poll(completion, executionId),
		identities: [{ executionId, workflowName: workflow._tag }],
		isSettled: (result) =>
			Option.isSome(result) ? result.value._tag === "Complete" : options.requireReply !== true,
	});
});

export const interruptExecutionAndWait = (identity: WorkflowIdentity) =>
	interruptWorkflowAndWait(namedWorkflow(identity), identity.executionId);
