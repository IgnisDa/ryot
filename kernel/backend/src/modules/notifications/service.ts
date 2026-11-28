import type { CurrentUserValue } from "@ryot-app/contract/auth-middleware";
import {
	type CreateNotificationChannelBody,
	NotificationNotFoundError,
	type UpdateNotificationChannelBody,
} from "@ryot-app/contract/modules/notifications/schemas";
import type { NotificationChannelId, UserId } from "@ryot-app/contract/schema/brands";
import type { Message } from "@ryot-app/i18n/message";
import { generateId } from "better-auth";
import { Context, Effect, Layer } from "effect";

import type { WriteTransaction } from "#platform/db/write-transaction";

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

			/** Admits a run's message within the caller's transaction; delivery is queued work. */
			const admitMessageWithin = Effect.fn("NotificationsService.admitMessageWithin")(function* (
				input: { message: Message; sourceKey: string; sourceRunId: string; accountUserId: UserId },
				transaction: WriteTransaction,
			) {
				return yield* admissions.admitWithin(
					{
						sourceSubmittedAt: null,
						sourceKey: input.sourceKey,
						userId: input.accountUserId,
						sourceRunId: input.sourceRunId,
						accountUserId: input.accountUserId,
						request: { kind: "message", message: input.message },
					},
					transaction,
				);
			});

			return { test, create, update, delete: remove, admitMessageWithin };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
