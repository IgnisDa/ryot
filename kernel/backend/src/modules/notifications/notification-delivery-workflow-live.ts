import { DbError } from "@ryot-app/contract/errors";
import { Effect, Layer, Schema } from "effect";

import { implementWorkflow, makeActivity } from "#lib/infrastructure/workflow-scope";

import { deliverEnabledChannels } from "./deliver-enabled-channels";
import {
	NotificationDeliveryResult,
	NotificationDeliveryWorkflow,
	type NotificationDeliveryWorkflowPayload,
} from "./notification-delivery-workflow";

export const runNotificationDeliveryWorkflow = Effect.fn("NotificationDeliveryWorkflow")(
	function* (payload: NotificationDeliveryWorkflowPayload, executionId: string) {
		yield* Effect.annotateCurrentSpan({ executionId, userId: payload.userId });
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

const NotificationDeliveryWorkflowLive = implementWorkflow(
	NotificationDeliveryWorkflow,
	runNotificationDeliveryWorkflow,
);

export const NotificationDeliveryWorkflowDefinitionsLive = Layer.mergeAll(
	NotificationDeliveryWorkflowLive,
);
