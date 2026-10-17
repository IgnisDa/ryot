import { Schema } from "effect";

import { WorkflowIdentity } from "#platform/workflow/identity";

export const workflowEntityPrefix = "Workflow/";
export const workflowClockEntityType = "Workflow/-/DurableClock";

export const WorkflowParentPayload = Schema.Struct({
	"~effect/cluster/ClusterWorkflowEngine/payloadParentKey": Schema.optional(WorkflowIdentity),
});

export const WorkflowClockPayload = Schema.Struct({ workflowName: Schema.String });

export const StoredWorkflowResult = Schema.Union([
	Schema.TaggedStruct("Suspended", {}),
	Schema.TaggedStruct("Complete", {
		exit: Schema.Struct({ _tag: Schema.Literals(["Success", "Failure"]) }),
	}),
]);

export class WorkflowExecutionExpired extends Schema.TaggedError<
	WorkflowExecutionExpired,
	{ readonly brand: unique symbol }
>()("WorkflowExecutionExpired", WorkflowIdentity.fields) {}
