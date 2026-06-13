import { Workflow } from "@effect/workflow";
import { DbError } from "@ryot/contract/errors";
import { NotificationDeliveryResult } from "@ryot/contract/modules/notifications/schemas";
import { NotificationEventType } from "@ryot/contract/modules/notifications/types";
import { UserId } from "@ryot/contract/schema/brands";
import { generateId } from "better-auth";
import { Schema } from "effect";

export const NotificationDeliveryRequest = Schema.Union(
	Schema.Struct({ kind: Schema.Literal("test") }),
	Schema.Struct({
		message: Schema.String,
		kind: Schema.Literal("event"),
		eventType: NotificationEventType,
	}),
);

export const NotificationDeliveryWorkflowPayload = Schema.Struct({
	userId: UserId,
	executionId: Schema.String,
	request: NotificationDeliveryRequest,
});

export type NotificationDeliveryWorkflowPayload = typeof NotificationDeliveryWorkflowPayload.Type;

type NotificationDeliveryWorkflowInput = Omit<
	NotificationDeliveryWorkflowPayload,
	"executionId"
> & { executionId?: string };

export const NotificationDeliveryWorkflow = Workflow.make({
	error: DbError,
	name: "NotificationDeliveryWorkflow",
	payload: NotificationDeliveryWorkflowPayload,
	idempotencyKey: ({ executionId }) => executionId,
	success: Schema.Array(NotificationDeliveryResult),
});

const withExecutionId = (input: NotificationDeliveryWorkflowInput) => ({
	...input,
	executionId: input.executionId ?? generateId(),
});

export const enqueueNotificationDelivery = (input: NotificationDeliveryWorkflowInput) =>
	NotificationDeliveryWorkflow.execute(withExecutionId(input), { discard: true });
