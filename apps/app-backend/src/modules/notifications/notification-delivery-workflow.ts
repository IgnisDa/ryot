import { DbError } from "@ryot/contract/errors";
import { NotificationChannelKind } from "@ryot/contract/modules/notifications/types";
import { NotificationChannelId, UserId } from "@ryot/contract/schema/brands";
import { generateId } from "better-auth";
import { Schema } from "effect";
import { Workflow } from "effect/unstable/workflow";

import type { DurableSchema } from "#lib/infrastructure/workflow";

export const NotificationDeliveryRequest = Schema.Union([
	Schema.Struct({ kind: Schema.Literal("test") }),
	Schema.Struct({
		message: Schema.String,
		kind: Schema.Literal("message"),
	}),
]);

export const NotificationDeliveryResult = Schema.Struct({
	channel: NotificationChannelKind,
	channelId: NotificationChannelId,
	status: Schema.Literals(["sent", "failed"]),
});

export type NotificationDeliveryResult = typeof NotificationDeliveryResult.Type;

export const NotificationDeliveryWorkflowPayload = Schema.Struct({
	userId: UserId,
	executionId: Schema.String,
	request: NotificationDeliveryRequest,
});

export type NotificationDeliveryWorkflowPayload = typeof NotificationDeliveryWorkflowPayload.Type;

type NotificationDeliveryWorkflowInput = Omit<
	NotificationDeliveryWorkflowPayload,
	"executionId"
> & { executionId?: string | undefined };

export const NotificationDeliveryWorkflow = Workflow.make("NotificationDeliveryWorkflow", {
	error: DbError satisfies DurableSchema,
	payload: NotificationDeliveryWorkflowPayload satisfies DurableSchema,
	idempotencyKey: ({ executionId }) => executionId,
	success: Schema.Array(NotificationDeliveryResult) satisfies DurableSchema,
});

const withExecutionId = (input: NotificationDeliveryWorkflowInput) => ({
	...input,
	executionId: input.executionId ?? generateId(),
});

export const enqueueNotificationDelivery = (input: NotificationDeliveryWorkflowInput) =>
	NotificationDeliveryWorkflow.execute(withExecutionId(input), { discard: true });
