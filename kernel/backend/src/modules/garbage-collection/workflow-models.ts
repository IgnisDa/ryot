import { Effect, Schema } from "effect";
import type { Reply } from "effect/cluster";

import { WorkflowIdentity } from "#lib/infrastructure/workflow-identity";

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

export const terminalWorkflowReplyIdentity = (
	reply: Reply.Encoded,
	request: WorkflowIdentity & { readonly entityType: string; readonly tag: string | null },
) =>
	Effect.gen(function* () {
		if (
			reply._tag !== "WithExit" ||
			request.tag !== "run" ||
			!request.entityType.startsWith(workflowEntityPrefix) ||
			request.entityType === workflowClockEntityType
		) {
			return undefined;
		}
		if (reply.exit._tag === "Failure") {
			return { executionId: request.executionId, workflowName: request.workflowName };
		}
		const result = yield* Schema.decodeUnknownEffect(StoredWorkflowResult)(reply.exit.value);
		return result._tag === "Complete"
			? { executionId: request.executionId, workflowName: request.workflowName }
			: undefined;
	});

export class WorkflowExecutionExpired extends Schema.TaggedError<WorkflowExecutionExpired>()(
	"WorkflowExecutionExpired",
	WorkflowIdentity.fields,
) {}
