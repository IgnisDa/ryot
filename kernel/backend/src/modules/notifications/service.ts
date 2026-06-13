import type { CurrentUserValue } from "@ryot-app/contract/auth-middleware";
import {
	NotificationNotFoundError,
	NotificationRequestError,
	type CreateNotificationChannelBody,
	type UpdateNotificationChannelBody,
} from "@ryot-app/contract/modules/notifications/schemas";
import type { NotificationChannelId, UserId } from "@ryot-app/contract/schema/brands";
import { Context, Effect, Layer } from "effect";
import { WorkflowEngine } from "effect/unstable/workflow/WorkflowEngine";

import { enqueueNotificationDelivery } from "./notification-delivery-workflow";
import { NotificationsRepository } from "./repository";

export class NotificationsService extends Context.Service<NotificationsService>()(
	"NotificationsService",
	{
		make: Effect.gen(function* () {
			const engine = yield* WorkflowEngine;
			const repository = yield* NotificationsRepository;

			const provideWorkflowEngine = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
				effect.pipe(Effect.provideService(WorkflowEngine, engine));

			const create = Effect.fn("NotificationsService.create")(function* (
				user: CurrentUserValue,
				body: CreateNotificationChannelBody,
			) {
				if (body.channel !== body.channelSpecifics.kind) {
					return yield* new NotificationRequestError({
						reason: {
							channel: body.channel,
							code: "channel-kind-mismatch",
							specificsKind: body.channelSpecifics.kind,
						},
					});
				}

				const channel = yield* repository.createForUser({
					userId: user.id,
					channel: body.channel,
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
						reason: { code: "channel-not-found", channelId },
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
						reason: { code: "channel-not-found", channelId },
					});
				}
				return { id: channelId };
			});

			const test = Effect.fn("NotificationsService.test")(function* (user: CurrentUserValue) {
				yield* provideWorkflowEngine(
					enqueueNotificationDelivery({ userId: user.id, request: { kind: "test" } }),
				);
				return undefined;
			});

			const sendMessage = Effect.fn("NotificationsService.sendMessage")(function* (input: {
				userId: UserId;
				message: string;
				executionId?: string | undefined;
			}) {
				yield* provideWorkflowEngine(
					enqueueNotificationDelivery({
						userId: input.userId,
						executionId: input.executionId,
						request: { kind: "message", message: input.message },
					}),
				);
				return undefined;
			});

			return { create, delete: remove, sendMessage, test, update };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
