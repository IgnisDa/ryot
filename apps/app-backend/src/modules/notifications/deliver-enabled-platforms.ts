import { Effect } from "effect";

import { DbRunner } from "#lib/infrastructure/db/service";

import { NotificationDeliveryService } from "./delivery";
import type {
	NotificationDeliveryResult,
	NotificationDeliveryWorkflowPayload,
} from "./notification-delivery-workflow";
import { NotificationsRepository, type NotificationPlatformRecord } from "./repository";

const toDeliveryResult = (
	platform: NotificationPlatformRecord,
	status: NotificationDeliveryResult["status"],
): NotificationDeliveryResult => ({
	status,
	platformId: platform.id,
	platform: platform.platform,
});

export const deliverEnabledPlatforms = Effect.fn("deliverEnabledPlatforms")(function* (
	payload: NotificationDeliveryWorkflowPayload,
) {
	const runWithDb = yield* DbRunner;
	const repository = yield* NotificationsRepository;
	const delivery = yield* NotificationDeliveryService;

	const eventType = payload.request.kind === "event" ? payload.request.eventType : undefined;
	const platforms = yield* runWithDb(
		repository.listEnabledForUser({ userId: payload.userId, eventType }),
	);

	return yield* Effect.forEach(
		platforms,
		(platform) => {
			const message =
				payload.request.kind === "test"
					? `This is a test notification for platform: ${platform.platform}`
					: payload.request.message;
			return delivery.send({ message, platformSpecifics: platform.platformSpecifics }).pipe(
				Effect.as<NotificationDeliveryResult["status"]>("sent"),
				Effect.orElseSucceed(() => "failed" as const),
				Effect.map((status) => toDeliveryResult(platform, status)),
			);
		},
		{ concurrency: 4 },
	);
});
