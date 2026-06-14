import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import type { CurrentUserValue } from "@ryot/contract/auth-middleware";
import { badRequest, notFound } from "@ryot/contract/errors";
import type {
	CreateNotificationPlatformBody,
	UpdateNotificationPlatformBody,
} from "@ryot/contract/modules/notifications/schemas";
import {
	notificationEventTypes,
	type NotificationEventType,
} from "@ryot/contract/modules/notifications/types";
import type { NotificationPlatformId, UserId } from "@ryot/contract/schema/brands";
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

			return { create, delete: remove, list, test, trigger, update };
		}),
	},
) {}
