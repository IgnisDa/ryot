import type { CurrentUserValue } from "@ryot-app/contract/auth-middleware";
import {
	type CreateNotificationChannelBody,
	NotificationNotFoundError,
	type TestNotificationChannelsBody,
	type UpdateNotificationChannelBody,
} from "@ryot-app/contract/modules/notifications/schemas";
import type { AccountGeneration } from "@ryot-app/contract/schema/account-generation";
import type { NotificationChannelId } from "@ryot-app/contract/schema/brands";
import { Context, Effect, Layer } from "effect";

import { requireOpenSubmission } from "#modules/mutations/submission-window";

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

			const test = Effect.fn("NotificationsService.test")(function* (
				user: CurrentUserValue,
				body: TestNotificationChannelsBody,
			) {
				yield* requireOpenSubmission(body.submittedAt);
				return yield* admissions.admit({
					userId: user.id,
					sourceRunId: null,
					request: { kind: "test" },
					sourceSubmittedAt: body.submittedAt,
					accountGeneration: user.accountGeneration,
					sourceKey: `channel-test:${body.idempotencyKey}`,
				});
			});

			const sendMessage = Effect.fn("NotificationsService.sendMessage")(function* (input: {
				message: string;
				sourceKey: string;
				sourceRunId: string;
				accountGeneration: AccountGeneration;
			}) {
				return yield* admissions.admit({
					sourceSubmittedAt: null,
					sourceKey: input.sourceKey,
					sourceRunId: input.sourceRunId,
					userId: input.accountGeneration.userId,
					accountGeneration: input.accountGeneration,
					request: { kind: "message", message: input.message.trim() },
				});
			});

			return { test, create, update, sendMessage, delete: remove };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
