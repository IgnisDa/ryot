import {
	AssistantApprovalDecision,
	AssistantTurnFailure,
} from "@ryot-app/contract/modules/assistant/schemas";
import { UserId } from "@ryot-app/contract/schema/brands";
import { Schema } from "effect";
import { DurableDeferred, Workflow } from "effect/workflow";

export const AssistantTurnWorkflow = Workflow.make("AssistantTurnWorkflow", {
	success: Schema.Void,
	error: AssistantTurnFailure,
	idempotencyKey: ({ turnId }) => turnId,
	payload: Schema.Struct({ userId: UserId, turnId: Schema.String }),
});

export const assistantApproval = (callId: string) =>
	DurableDeferred.make(`approval:${callId}`, { success: AssistantApprovalDecision });
