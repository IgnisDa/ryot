import { DbError } from "@ryot/contract/errors";
import { Effect, Layer, Schema } from "effect";
import { Activity } from "effect/unstable/workflow";

import { deliverEnabledChannels } from "./deliver-enabled-channels";
import {
	NotificationDeliveryResult,
	NotificationDeliveryWorkflow,
	type NotificationDeliveryWorkflowPayload,
} from "./notification-delivery-workflow";

export const runNotificationDeliveryWorkflow = Effect.fn("NotificationDeliveryWorkflow")(
	function* (payload: NotificationDeliveryWorkflowPayload, executionId: string) {
		yield* Effect.annotateCurrentSpan({ executionId, userId: payload.userId });
		return yield* Activity.make({
			error: DbError,
			name: "deliver-enabled-channels",
			execute: deliverEnabledChannels(payload),
			success: Schema.Array(NotificationDeliveryResult),
		});
	},
	(effect, _payload, executionId) =>
		Effect.annotateLogs(effect, { executionId, workflow: "NotificationDeliveryWorkflow" }),
);

const NotificationDeliveryWorkflowLive = NotificationDeliveryWorkflow.toLayer(
	runNotificationDeliveryWorkflow,
);

export const NotificationDeliveryWorkflowDefinitionsLive = Layer.mergeAll(
	NotificationDeliveryWorkflowLive,
);
