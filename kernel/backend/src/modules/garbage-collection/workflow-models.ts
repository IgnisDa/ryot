import { Schema } from "effect";

export const workflowEntityPrefix = "Workflow/";
export const workflowClockEntityType = "Workflow/-/DurableClock";

const WorkflowIdentity = Schema.Struct({ executionId: Schema.String, workflowName: Schema.String });
export type WorkflowIdentity = typeof WorkflowIdentity.Type;

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

export class WorkflowExecutionExpired extends Schema.TaggedError<WorkflowExecutionExpired>()(
	"WorkflowExecutionExpired",
	WorkflowIdentity.fields,
) {}
