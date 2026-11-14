import type { CurrentUserValue } from "@ryot-app/contract/auth-middleware";
import {
	type CreateNotificationChannelBody,
	NotificationNotFoundError,
	type UpdateNotificationChannelBody,
} from "@ryot-app/contract/modules/notifications/schemas";
import type { NotificationChannelId, UserId } from "@ryot-app/contract/schema/brands";
import { generateId } from "better-auth";
import { Context, Effect, Layer } from "effect";

import { NotificationAdmissions } from "./admission";
import { NotificationsRepository } from "./repository";

export class NotificationsService extends Context.Service<NotificationsService>()(
	"@ryot-app/kernel-backend/modules/notifications/service/NotificationsService",
	{
		make: Effect.gen(function* () {
			const admissions = yield* NotificationAdmissions;
			const repository = yield* NotificationsRepository;

			const create = Effect.fn("NotificationsService.create")(function* (
				user: CurrentUserValue,
				body: CreateNotificationChannelBody,
			) {
				const channel = yield* repository.createForUser({
					userId: user.id,
					isDisabled: body.isDisabled ?? false,
					channelSpecifics: body.channelSpecifics,
				});
				return { id: channel.id };
			});

			const update = Effect.fn("NotificationsService.update")(function* (
				user: CurrentUserValue,
				channelId: NotificationChannelId,
				body: UpdateNotificationChannelBody,
			) {
				const channel = yield* repository.updateForUser({ body, channelId, userId: user.id });
				if (!channel) {
					return yield* new NotificationNotFoundError({
						reason: { channelId, code: "channel-not-found" },
					});
				}
				return channel;
			});

			const remove = Effect.fn("NotificationsService.delete")(function* (
				user: CurrentUserValue,
				channelId: NotificationChannelId,
			) {
				const deleted = yield* repository.deleteForUser({ channelId, userId: user.id });
				if (!deleted) {
					return yield* new NotificationNotFoundError({
						reason: { channelId, code: "channel-not-found" },
					});
				}
				return { id: channelId };
			});

			const test = Effect.fn("NotificationsService.test")(function* (user: CurrentUserValue) {
				return yield* admissions.admit({
					userId: user.id,
					sourceRunId: null,
					accountUserId: user.id,
					sourceSubmittedAt: null,
					request: { kind: "test" },
					sourceKey: `channel-test:${generateId()}`,
				});
			});

			const sendMessage = Effect.fn("NotificationsService.sendMessage")(function* (input: {
				message: string;
				sourceKey: string;
				sourceRunId: string;
				accountUserId: UserId;
			}) {
				return yield* admissions.admit({
					sourceSubmittedAt: null,
					sourceKey: input.sourceKey,
					userId: input.accountUserId,
					sourceRunId: input.sourceRunId,
					accountUserId: input.accountUserId,
					request: { kind: "message", message: input.message.trim() },
				});
			});

			return { test, create, update, sendMessage, delete: remove };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
