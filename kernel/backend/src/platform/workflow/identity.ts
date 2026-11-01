import { Schema } from "effect";

export const WorkflowIdentity = Schema.Struct({
	executionId: Schema.String,
	workflowName: Schema.String,
});

export type WorkflowIdentity = typeof WorkflowIdentity.Type;

export class WorkflowExecutionExpired extends Schema.TaggedError<
	WorkflowExecutionExpired,
	{ readonly brand: unique symbol }
>()("WorkflowExecutionExpired", WorkflowIdentity.fields) {}
