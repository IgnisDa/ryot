import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import type { CurrentUserValue } from "@ryot/contract/auth-middleware";
import { badRequest, notFound } from "@ryot/contract/errors";
import type {
	CreateNotificationChannelBody,
	UpdateNotificationChannelBody,
} from "@ryot/contract/modules/notifications/schemas";
import type { NotificationChannelId } from "@ryot/contract/schema/brands";
import { Effect } from "effect";

import { DbRunner } from "#lib/infrastructure/db/service";

import { enqueueNotificationDelivery } from "./notification-delivery-workflow";
import { NotificationsRepository } from "./repository";

export class NotificationsService extends Effect.Service<NotificationsService>()(
	"NotificationsService",
	{
		effect: Effect.gen(function* () {
			const runWithDb = yield* DbRunner;
			const engine = yield* WorkflowEngine;
			const repository = yield* NotificationsRepository;

			const list = Effect.fn("NotificationsService.list")(function* (user: CurrentUserValue) {
				return yield* runWithDb(repository.listForUser(user.id));
			});

			const create = Effect.fn("NotificationsService.create")(function* (
				user: CurrentUserValue,
				body: CreateNotificationChannelBody,
			) {
				if (body.kind !== body.specifics.kind) {
					return yield* badRequest("kind must match specifics.kind");
				}

				const channel = yield* runWithDb(
					repository.createForUser({
						kind: body.kind,
						userId: user.id,
						specifics: body.specifics,
						isDisabled: body.isDisabled ?? false,
					}),
				);
				return { id: channel.id };
			});

			const update = Effect.fn("NotificationsService.update")(function* (
				user: CurrentUserValue,
				channelId: NotificationChannelId,
				body: UpdateNotificationChannelBody,
			) {
				const channel = yield* runWithDb(
					repository.updateForUser({ body, channelId, userId: user.id }),
				);
				if (!channel) {
					return yield* notFound("Notification channel not found");
				}
				return channel;
			});

			const remove = Effect.fn("NotificationsService.delete")(function* (
				user: CurrentUserValue,
				channelId: NotificationChannelId,
			) {
				const deleted = yield* runWithDb(repository.deleteForUser({ channelId, userId: user.id }));
				if (!deleted) {
					return yield* notFound("Notification channel not found");
				}
				return { id: channelId };
			});

			const test = Effect.fn("NotificationsService.test")(function* (user: CurrentUserValue) {
				yield* enqueueNotificationDelivery({
					userId: user.id,
					request: { kind: "test" },
				}).pipe(Effect.provideService(WorkflowEngine, engine));
				return undefined;
			});

			return { create, delete: remove, list, test, update };
		}),
	},
) {}
