import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import type { CurrentUserValue } from "@ryot/contract/auth-middleware";
import { badRequest, notFound } from "@ryot/contract/errors";
import type {
	CreateNotificationChannelBody,
	UpdateNotificationChannelBody,
} from "@ryot/contract/modules/notifications/schemas";
import {
	notificationEventTypes,
	type NotificationEventType,
} from "@ryot/contract/modules/notifications/types";
import type { NotificationChannelId, UserId } from "@ryot/contract/schema/brands";
import { Effect } from "effect";

import { DbRunner } from "#lib/infrastructure/db/service";

import { enqueueNotificationDelivery } from "./notification-delivery-workflow";
import { NotificationsRepository } from "./repository";

const defaultConfiguredEvents = [...notificationEventTypes];

export class NotificationsService extends Effect.Service<NotificationsService>()(
	"NotificationsService",
	{
		effect: Effect.gen(function* () {
			const runWithDb = yield* DbRunner;
			const engine = yield* WorkflowEngine;
			const repository = yield* NotificationsRepository;

			const provideWorkflowEngine = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
				effect.pipe(Effect.provideService(WorkflowEngine, engine));

			const list = Effect.fn("NotificationsService.list")(function* (user: CurrentUserValue) {
				return yield* runWithDb(repository.listForUser(user.id));
			});

			const create = Effect.fn("NotificationsService.create")(function* (
				user: CurrentUserValue,
				body: CreateNotificationChannelBody,
			) {
				if (body.channel !== body.channelSpecifics.kind) {
					return yield* badRequest("channel must match channelSpecifics.kind");
				}

				const channel = yield* runWithDb(
					repository.createForUser({
						userId: user.id,
						channel: body.channel,
						isDisabled: body.isDisabled ?? false,
						channelSpecifics: body.channelSpecifics,
						configuredEvents: [...(body.configuredEvents ?? defaultConfiguredEvents)],
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
				yield* provideWorkflowEngine(
					enqueueNotificationDelivery({ userId: user.id, request: { kind: "test" } }),
				);
				return undefined;
			});

			const trigger = Effect.fn("NotificationsService.trigger")(function* (input: {
				userId: UserId;
				message: string;
				executionId?: string | undefined;
				eventType: NotificationEventType;
			}) {
				yield* provideWorkflowEngine(
					enqueueNotificationDelivery({
						userId: input.userId,
						executionId: input.executionId,
						request: { kind: "event", message: input.message, eventType: input.eventType },
					}),
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

			return { create, delete: remove, list, sendMessage, test, trigger, update };
		}),
	},
) {}
