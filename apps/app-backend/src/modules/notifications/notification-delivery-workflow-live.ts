import { Activity } from "@effect/workflow";
import { DbError } from "@ryot/contract/errors";
import { Effect, Layer, Schema } from "effect";

import { deliverEnabledChannels } from "./deliver-enabled-channels";
import {
	NotificationDeliveryResult,
	NotificationDeliveryWorkflow,
	type NotificationDeliveryWorkflowPayload,
} from "./notification-delivery-workflow";

export const runNotificationDeliveryWorkflow = Effect.fn("runNotificationDeliveryWorkflow")(
	function* (payload: NotificationDeliveryWorkflowPayload) {
		return yield* Activity.make({
			error: DbError,
			name: "deliver-enabled-channels",
			execute: deliverEnabledChannels(payload),
			success: Schema.Array(NotificationDeliveryResult),
		});
	},
);

const NotificationDeliveryWorkflowLive = NotificationDeliveryWorkflow.toLayer(
	(payload, executionId) =>
		runNotificationDeliveryWorkflow(payload).pipe(
			Effect.withSpan("NotificationDeliveryWorkflow", {
				attributes: { executionId, userId: payload.userId },
			}),
			Effect.annotateLogs({ executionId, workflow: "NotificationDeliveryWorkflow" }),
		),
);

export const NotificationDeliveryWorkflowDefinitionsLive = Layer.mergeAll(
	NotificationDeliveryWorkflowLive,
);
