import { DbError } from "@ryot-app/contract/errors";
import { Duration, Effect } from "effect";

import { makeJobKind } from "#platform/jobs/queue";
import { type JobContext, registerJobHandler } from "#platform/jobs/worker";

import { deliverEnabledChannels } from "./deliver-enabled-channels";
import { NotificationDeliveryRepository } from "./delivery-repository";
import { NotificationDeliveryPayload } from "./ledger";

export const NotificationDeliveryJob = makeJobKind("notification-delivery", {
	concurrency: 4,
	lease: Duration.minutes(2),
	payload: NotificationDeliveryPayload,
});

// A claim left Sending by an interrupted attempt settles as Unknown only once it is old enough, so
// the job retries until then instead of leaving the notification admitted.
export const runNotificationDelivery = Effect.fn("NotificationDeliveryJob")(function* (
	payload: NotificationDeliveryPayload,
	job: JobContext,
) {
	yield* Effect.annotateCurrentSpan({
		jobId: job.id,
		notificationId: payload.notificationId,
		userId: payload.accountGeneration.userId,
	});
	yield* deliverEnabledChannels(payload);
	const notification = yield* (yield* NotificationDeliveryRepository).find(payload.notificationId);
	if (notification?.state === "admitted") {
		return yield* new DbError({ message: "Notification has an unsettled Sending claim" });
	}
	return yield* Effect.void;
});

export const NotificationDeliveryJobLive = registerJobHandler(
	NotificationDeliveryJob,
	runNotificationDelivery,
);
