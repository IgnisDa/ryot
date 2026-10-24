import { DbError } from "@ryot-app/contract/errors";
import { NotificationDeliveryResult } from "@ryot-app/contract/modules/notifications/delivery";
import { Effect, Schema } from "effect";

import { MutationReceipts } from "#modules/mutations/receipts";
import { admitWorkflow } from "#modules/mutations/workflow-dispatch";
import { implementWorkflow, makeActivity } from "#platform/workflow/scope";

import { deliverEnabledChannels } from "./deliver-enabled-channels";
import {
	NotificationDeliveryWorkflow,
	type NotificationDeliveryWorkflowPayload,
} from "./notification-delivery-workflow";

export const runNotificationDeliveryWorkflow = Effect.fn("NotificationDeliveryWorkflow")(
	function* (payload: NotificationDeliveryWorkflowPayload, executionId: string) {
		yield* Effect.annotateCurrentSpan({
			executionId,
			notificationId: payload.notificationId,
			userId: payload.accountGeneration.userId,
		});
		yield* admitWorkflow(
			yield* MutationReceipts,
			NotificationDeliveryWorkflow,
			payload.accountGeneration,
			executionId,
		);
		return yield* makeActivity({
			error: DbError,
			name: "deliver-enabled-channels",
			execute: deliverEnabledChannels(payload),
			success: Schema.Array(NotificationDeliveryResult),
		});
	},
	(effect, _payload, executionId) =>
		Effect.annotateLogs(effect, { executionId, workflow: "NotificationDeliveryWorkflow" }),
);

export const NotificationDeliveryWorkflowDefinitionsLive = implementWorkflow(
	NotificationDeliveryWorkflow,
	runNotificationDeliveryWorkflow,
);
