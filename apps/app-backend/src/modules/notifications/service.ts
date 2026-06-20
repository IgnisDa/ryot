import type { CurrentUserValue } from "@ryot/contract/auth-middleware";
import { badRequest, notFound } from "@ryot/contract/errors";
import type {
	CreateNotificationPlatformBody,
	NotificationDeliveryResult,
	UpdateNotificationPlatformBody,
} from "@ryot/contract/modules/notifications/schemas";
import {
	notificationEventTypes,
	type NotificationEventType,
} from "@ryot/contract/modules/notifications/types";
import type { NotificationPlatformId, UserId } from "@ryot/contract/schema/brands";
import { Effect } from "effect";

import { DbRunner } from "#lib/infrastructure/db/service";

import { NotificationDeliveryService } from "./delivery";
import { NotificationsRepository, type NotificationPlatformRecord } from "./repository";

const defaultConfiguredEvents = [...notificationEventTypes];

const toDeliveryResult = (
	platform: NotificationPlatformRecord,
	status: NotificationDeliveryResult["status"],
): NotificationDeliveryResult => ({
	status,
	platformId: platform.id,
	platform: platform.platform,
});

export class NotificationsService extends Effect.Service<NotificationsService>()(
	"NotificationsService",
	{
		effect: Effect.gen(function* () {
			const runWithDb = yield* DbRunner;
			const repository = yield* NotificationsRepository;
			const delivery = yield* NotificationDeliveryService;

			const requirePlatform = Effect.fn("NotificationsService.requirePlatform")(function* (
				userId: UserId,
				platformId: NotificationPlatformId,
			) {
				const platform = yield* runWithDb(repository.getForUser({ platformId, userId }));
				if (!platform) {
					return yield* notFound("Notification platform not found");
				}
				return platform;
			});

			const deliver = Effect.fn("NotificationsService.deliver")(function* (input: {
				message: string;
				platform: NotificationPlatformRecord;
			}) {
				const status = yield* delivery
					.send({ message: input.message, platformSpecifics: input.platform.platformSpecifics })
					.pipe(
						Effect.as<NotificationDeliveryResult["status"]>("sent"),
						Effect.catchAll(() => Effect.succeed<NotificationDeliveryResult["status"]>("failed")),
					);
				return toDeliveryResult(input.platform, status);
			});

			const list = Effect.fn("NotificationsService.list")(function* (user: CurrentUserValue) {
				return yield* runWithDb(repository.listForUser(user.id));
			});

			const create = Effect.fn("NotificationsService.create")(function* (
				user: CurrentUserValue,
				body: CreateNotificationPlatformBody,
			) {
				if (body.platform !== body.platformSpecifics.kind) {
					return yield* badRequest("platform must match platformSpecifics.kind");
				}

				const platform = yield* runWithDb(
					repository.createForUser({
						userId: user.id,
						platform: body.platform,
						isDisabled: body.isDisabled ?? false,
						platformSpecifics: body.platformSpecifics,
						configuredEvents: [...(body.configuredEvents ?? defaultConfiguredEvents)],
					}),
				);
				return { id: platform.id };
			});

			const update = Effect.fn("NotificationsService.update")(function* (
				user: CurrentUserValue,
				platformId: NotificationPlatformId,
				body: UpdateNotificationPlatformBody,
			) {
				yield* requirePlatform(user.id, platformId);
				const platform = yield* runWithDb(
					repository.updateForUser({ body, platformId, userId: user.id }),
				);
				if (!platform) {
					return yield* notFound("Notification platform not found");
				}
				return platform;
			});

			const remove = Effect.fn("NotificationsService.delete")(function* (
				user: CurrentUserValue,
				platformId: NotificationPlatformId,
			) {
				const deleted = yield* runWithDb(repository.deleteForUser({ platformId, userId: user.id }));
				if (!deleted) {
					return yield* notFound("Notification platform not found");
				}
				return { id: platformId };
			});

			const test = Effect.fn("NotificationsService.test")(function* (user: CurrentUserValue) {
				const platforms = yield* runWithDb(repository.listEnabledForUser({ userId: user.id }));
				return yield* Effect.forEach(
					platforms,
					(platform) =>
						deliver({
							platform,
							message: `This is a test notification for platform: ${platform.platform}`,
						}),
					{ concurrency: 4 },
				);
			});

			const triggerForUser = Effect.fn("NotificationsService.triggerForUser")(function* (input: {
				userId: UserId;
				message: string;
				eventType: NotificationEventType;
			}) {
				const platforms = yield* runWithDb(
					repository.listEnabledForUser({ eventType: input.eventType, userId: input.userId }),
				);
				return yield* Effect.forEach(
					platforms,
					(platform) => deliver({ message: input.message, platform }),
					{ concurrency: 4 },
				);
			});

			return { create, delete: remove, list, test, triggerForUser, update };
		}),
	},
) {}
