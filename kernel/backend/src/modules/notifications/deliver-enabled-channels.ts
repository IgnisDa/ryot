import { DbError } from "@ryot-app/contract/errors";
import type { NotificationChannelOutcome } from "@ryot-app/contract/modules/notifications/delivery";
import { NotificationChannelId } from "@ryot-app/contract/schema/brands";
import { generateId } from "better-auth";
import { DateTime, Effect, Schedule } from "effect";

import { MutationReceipts } from "#modules/mutations/receipts";
import { AppConfig } from "#platform/config/service";
import { DatabaseSession } from "#platform/db/session";

import { NotificationDeliveryService } from "./delivery";
import { NotificationDeliveryRepository } from "./delivery-repository";
import { NOTIFICATION_ATTEMPT_TIMEOUT_MS } from "./ledger";
import type { NotificationDeliveryWorkflowPayload } from "./notification-delivery-workflow";
import { NotificationsRepository } from "./repository";
import { NotificationSourcePolicy } from "./source-policy";

export const deliverEnabledChannels = Effect.fn("deliverEnabledChannels")(
	function* (payload: NotificationDeliveryWorkflowPayload) {
		const session = yield* DatabaseSession;
		const receipts = yield* MutationReceipts;
		const repository = yield* NotificationDeliveryRepository;
		const delivery = yield* NotificationDeliveryService;
		const channels = yield* NotificationsRepository;
		const config = yield* AppConfig;
		const sources = yield* NotificationSourcePolicy;
		yield* session.transaction(receipts.admitAccount(payload.accountGeneration));
		const notification = yield* repository.find(payload.notificationId);
		if (
			!notification ||
			notification.userId !== payload.accountGeneration.userId ||
			notification.accountGeneration !== payload.accountGeneration.token
		) {
			return yield* new DbError({ message: "Notification does not match its admitted account" });
		}
		const selected = yield* repository.deliveries(notification.id);
		yield* Effect.forEach(
			selected,
			(selectedChannel) =>
				Effect.gen(function* () {
					if (selectedChannel.status !== "queued") {
						return;
					}
					const current = yield* channels.findForUser({
						userId: payload.accountGeneration.userId,
						channelId: NotificationChannelId.make(selectedChannel.channelId),
					});
					const message =
						notification.request.kind === "test"
							? `This is a test notification for channel: ${selectedChannel.channel}`
							: notification.request.message;
					const prepared =
						current && !config.server.disableNotifications
							? yield* delivery
									.prepare({ message, channelSpecifics: current.channelSpecifics })
									.pipe(Effect.timeout(NOTIFICATION_ATTEMPT_TIMEOUT_MS), Effect.result)
							: null;
					const attemptId = generateId();
					const now = yield* DateTime.nowAsDate;
					const claimed = yield* session.transaction(
						Effect.gen(function* () {
							yield* receipts.admitAccount(payload.accountGeneration);
							const sourceAuthorized = yield* sources.authorize({
								runId: notification.sourceRunId,
								accountGeneration: payload.accountGeneration,
							});
							return yield* repository.claim({
								now,
								attemptId,
								sourceAuthorized,
								notificationId: notification.id,
								channelId: selectedChannel.channelId,
								disabled: config.server.disableNotifications,
								...(prepared?._tag === "Failure"
									? {
											preparationFailure:
												prepared.failure._tag === "NotificationDeliveryError"
													? prepared.failure.message
													: "Notification preparation timed out before sending",
										}
									: {}),
							});
						}),
					);
					if (!claimed || prepared?._tag !== "Success") {
						return;
					}
					const result = yield* prepared.success.execute.pipe(
						Effect.timeout(NOTIFICATION_ATTEMPT_TIMEOUT_MS),
						Effect.match({
							onSuccess: () => ({ diagnostic: null, status: "accepted" as const }),
							onFailure: (error): { diagnostic: string; status: NotificationChannelOutcome } => ({
								status: error._tag === "NotificationDeliveryError" ? error.outcome : "unknown",
								diagnostic:
									error._tag === "NotificationDeliveryError"
										? error.message
										: "Send timed out; provider acceptance is unknown",
							}),
						}),
					);
					const settledAt = yield* DateTime.nowAsDate;
					// Retry only persistence. The transport must never be inside this retry boundary.
					yield* session
						.transaction(
							repository.finishAttempt({
								...result,
								attemptId,
								now: settledAt,
								notificationId: notification.id,
								channelId: selectedChannel.channelId,
							}),
						)
						.pipe(
							Effect.retry(Schedule.exponential("100 millis").pipe(Schedule.upTo({ times: 3 }))),
						);
				}),
			{ discard: true, concurrency: 4 },
		);
		const now = yield* DateTime.nowAsDate;
		yield* session.transaction(repository.settle(notification.id, now));
		return (yield* repository.deliveries(notification.id)).map((row) => ({
			status: row.status,
			channel: row.channel,
			channelId: NotificationChannelId.make(row.channelId),
		}));
	},
	Effect.catchTag("DatabaseSessionStateError", Effect.die),
);
