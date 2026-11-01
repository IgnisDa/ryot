import { DbError } from "@ryot-app/contract/errors";
import { NotificationDeliveryResult } from "@ryot-app/contract/modules/notifications/delivery";
import { AccountGeneration } from "@ryot-app/contract/schema/account-generation";
import { Schema } from "effect";
import { Workflow } from "effect/workflow";

import type { DurableSchema } from "#boot/workflow-engine";

export const NotificationDeliveryWorkflowPayload = Schema.Struct({
	executionId: Schema.String,
	notificationId: Schema.String,
	accountGeneration: AccountGeneration,
});

export type NotificationDeliveryWorkflowPayload = typeof NotificationDeliveryWorkflowPayload.Type;

export const NotificationDeliveryWorkflow = Workflow.make("NotificationDeliveryWorkflow", {
	error: DbError satisfies DurableSchema,
	idempotencyKey: ({ executionId }) => executionId,
	payload: NotificationDeliveryWorkflowPayload satisfies DurableSchema,
	success: Schema.Array(NotificationDeliveryResult) satisfies DurableSchema,
});
