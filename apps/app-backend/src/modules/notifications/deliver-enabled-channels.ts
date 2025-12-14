import { Effect } from "effect";

import { DbRunner } from "#lib/infrastructure/db/service";

import { NotificationDeliveryService } from "./delivery";
import type {
	NotificationDeliveryResult,
	NotificationDeliveryWorkflowPayload,
} from "./notification-delivery-workflow";
import { NotificationsRepository, type NotificationChannelRecord } from "./repository";

const toDeliveryResult = (
	channel: NotificationChannelRecord,
	status: NotificationDeliveryResult["status"],
): NotificationDeliveryResult => ({
	status,
	kind: channel.kind,
	channelId: channel.id,
});

export const deliverEnabledChannels = Effect.fn("deliverEnabledChannels")(function* (
	payload: NotificationDeliveryWorkflowPayload,
) {
	const runWithDb = yield* DbRunner;
	const repository = yield* NotificationsRepository;
	const delivery = yield* NotificationDeliveryService;

	const channels = yield* runWithDb(repository.listEnabledForUser(payload.userId));

	return yield* Effect.forEach(
		channels,
		(channel) => {
			const message =
				payload.request.kind === "test"
					? `This is a test notification for channel: ${channel.kind}`
					: payload.request.message;
			return delivery.send({ message, specifics: channel.specifics }).pipe(
				Effect.as<NotificationDeliveryResult["status"]>("sent"),
				Effect.orElseSucceed(() => "failed" as const),
				Effect.map((status) => toDeliveryResult(channel, status)),
			);
		},
		{ concurrency: 4 },
	);
});
