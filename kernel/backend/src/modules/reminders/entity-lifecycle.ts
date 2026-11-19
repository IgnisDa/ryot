import { AutomationTriggerId, EntityId, UserId } from "@ryot-app/contract/schema/brands";
import { DateTime, Effect, Layer } from "effect";

import { AutomationRunRepository } from "#modules/automations/run-repository";
import { AutomationTriggerRepository } from "#modules/automations/trigger-repository";
import { EntityUserDataAttachments } from "#modules/entities/user-data/attachments";
import { NotificationDeliveryRepository } from "#modules/notifications/delivery-repository";

import { RemindersRepository } from "./repository";

export const ReminderEntityLifecycleLive = Layer.effect(
	EntityUserDataAttachments,
	Effect.gen(function* () {
		const repository = yield* RemindersRepository;
		const notifications = yield* NotificationDeliveryRepository;
		const triggers = yield* AutomationTriggerRepository;
		const runs = yield* AutomationRunRepository;
		const clear = Effect.fn("ReminderEntityLifecycle.clear")(function* (input: {
			userId: UserId;
			ids: ReadonlyArray<string>;
		}) {
			const now = yield* DateTime.nowAsDate;
			for (const id of [...input.ids].sort()) {
				const row = yield* repository.lockForUser(input.userId, id);
				if (row?.removedAt !== null) {
					continue;
				}
				yield* repository.update(row.id, {
					dueAt: null,
					message: null,
					removedAt: now,
					dispatch: null,
					entityId: null,
					timezone: null,
					updatedAt: now,
					entityTitle: null,
					parentEntityId: null,
					originalSchedule: null,
					revision: row.revision + 1,
					...(row.state === "settled"
						? {}
						: { settledAt: now, state: "cancelled", reason: "cancelled" }),
				});
				if (row.triggerId !== null) {
					const triggerId = AutomationTriggerId.make(row.triggerId);
					yield* triggers.erasePayload(triggerId, now);
					yield* runs.clearHistoryPayloads([triggerId]);
				}
				if (row.formatterRunId !== null) {
					yield* notifications.revokeRun(row.formatterRunId, now, true);
				}
			}
		});
		return EntityUserDataAttachments.of({
			clear,
			removeEntities: Effect.fn("ReminderEntityLifecycle.removeEntities")(function* (entityIds) {
				const rows = yield* repository.listForEntities({ entityIds });
				for (const [userId, reminders] of Map.groupBy(rows, (row) => row.userId)) {
					yield* clear({ userId: UserId.make(userId), ids: reminders.map((row) => row.id) });
				}
			}),
			list: (input) =>
				repository
					.listForEntities(input)
					.pipe(
						Effect.map((rows) =>
							rows.map((row) => ({
								id: row.id,
								revision: row.revision,
								entityId: row.entityId === null ? null : EntityId.make(row.entityId),
								parentEntityId:
									row.parentEntityId === null ? null : EntityId.make(row.parentEntityId),
							})),
						),
					),
			move: Effect.fn("ReminderEntityLifecycle.move")(function* (input) {
				const now = yield* DateTime.nowAsDate;
				for (const id of [...input.ids].sort()) {
					const row = yield* repository.lockForUser(input.userId, id);
					if (row?.removedAt !== null) {
						continue;
					}
					yield* repository.update(row.id, {
						updatedAt: now,
						revision: row.revision + 1,
						entityId:
							row.entityId === null
								? null
								: (input.references.get(EntityId.make(row.entityId)) ?? row.entityId),
						parentEntityId:
							row.parentEntityId === null
								? null
								: (input.references.get(EntityId.make(row.parentEntityId)) ?? row.parentEntityId),
					});
				}
			}),
		});
	}),
).pipe(
	Layer.provide(
		Layer.mergeAll(
			RemindersRepository.layer,
			NotificationDeliveryRepository.layer,
			AutomationTriggerRepository.layer,
			AutomationRunRepository.layer,
		),
	),
);
