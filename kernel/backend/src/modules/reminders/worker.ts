import { DbError } from "@ryot-app/contract/errors";
import type { NotificationOutcome } from "@ryot-app/contract/modules/notifications/delivery";
import type { ReminderReason } from "@ryot-app/contract/modules/reminders/schemas";
import {
	AutomationExecutionId,
	AutomationRunId,
	EntityId,
	SignalSchemaSlug,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { Context, DateTime, Effect, Layer } from "effect";

import { KernelSignals } from "#modules/automations/kernel-signals";
import { rootLifecycleCommand } from "#modules/automations/lifecycle/command";
import { LifecycleExecution } from "#modules/automations/lifecycle/execution";
import { toLifecycleDispatchPlan } from "#modules/automations/lifecycle/planning";
import { AutomationRunRepository } from "#modules/automations/run-repository";
import { DefinitionRepository } from "#modules/definitions/repository";
import { EntitiesRepository } from "#modules/entities/repository";
import { AccountAdmission } from "#modules/mutations/account-admission";
import { NotificationDeliveryRepository } from "#modules/notifications/delivery-repository";
import { summarizeNotification } from "#modules/notifications/ledger";
import { PluginRepository } from "#modules/plugins/packages/repository";
import { AppConfig } from "#platform/config/service";
import { DatabaseSession } from "#platform/db/session";
import type { WriteTransaction } from "#platform/db/write-transaction";

import { REMINDER_PAGE_LIMIT, RemindersRepository } from "./repository";

type ReminderRecord = NonNullable<
	Effect.Success<ReturnType<RemindersRepository["Service"]["findForUser"]>>
>;
const RECONCILE_DELAY_MS = 60_000;

export class ReminderWorker extends Context.Service<ReminderWorker>()(
	"@ryot-app/kernel-backend/modules/reminders/worker/ReminderWorker",
	{
		make: Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const repository = yield* RemindersRepository;
			const admission = yield* AccountAdmission.make;
			const entities = yield* EntitiesRepository;
			const plugins = yield* PluginRepository;
			const definitions = yield* DefinitionRepository;
			const kernelSignals = yield* KernelSignals.make;
			const execution = yield* LifecycleExecution;
			const notifications = yield* NotificationDeliveryRepository;
			const runs = yield* AutomationRunRepository;
			const config = yield* AppConfig;
			const transaction = <A, E, R>(work: Effect.Effect<A, E, R>) =>
				session.transaction(work).pipe(Effect.catchTag("DatabaseSessionStateError", Effect.die));
			const lockCandidate = Effect.fnUntraced(function* (
				captured: ReminderRecord,
				writes?: WriteTransaction,
			) {
				const userId = UserId.make(captured.userId);
				yield* admission.admitAccount(userId, writes);
				yield* plugins.lockIngestionShared([userId], writes);
				yield* entities.lockUserDataReferences(
					[captured.entityId, captured.parentEntityId]
						.filter((id) => id !== null)
						.map((id) => EntityId.make(id)),
				);
				const current = yield* repository.lockForUser(userId, captured.id);
				return current && current.revision === captured.revision && current.state === captured.state
					? current
					: null;
			});
			const settle = (
				row: ReminderRecord,
				now: Date,
				outcome: NotificationOutcome,
				reason: null | ReminderReason,
			) =>
				repository.update(row.id, {
					reason,
					outcome,
					settledAt: now,
					updatedAt: now,
					dispatch: null,
					state: "settled",
					revision: row.revision + 1,
				});
			const admitDue = Effect.fn("ReminderWorker.admitDue")(function* (
				captured: ReminderRecord,
				now: Date,
			) {
				if (
					captured.state !== "scheduled" ||
					captured.dueAt === null ||
					captured.dueAt > now ||
					captured.entityId === null ||
					captured.message === null ||
					captured.entityTitle === null ||
					captured.timezone === null
				) {
					return;
				}
				const userId = UserId.make(captured.userId);
				const reference = {
					owner: { kind: "kernel" as const },
					slug: SignalSchemaSlug.make("reminder.due"),
				};
				yield* kernelSignals.commit({
					userId,
					reference,
					subjectEntityId: EntityId.make(captured.entityId),
					properties: {
						reminderId: captured.id,
						message: captured.message,
						timezone: captured.timezone,
						entityId: captured.entityId,
						dueAt: captured.dueAt.toISOString(),
					},
					command: rootLifecycleCommand({
						lane: "background",
						source: "scheduler",
						accountUserId: userId,
						itemIdentity: captured.id,
						occurredAt: now.toISOString(),
						initiator: { id: userId, kind: "user" },
						executionId: AutomationExecutionId.make(`reminder-due:${captured.id}`),
					}),
					ledger: {
						check: (writes) => Effect.map(lockCandidate(captured, writes), (row) => row !== null),
						record: Effect.fnUntraced(function* (plan) {
							const definition = yield* definitions.findGlobalSignalSchema(reference);
							if (!definition) {
								return yield* new DbError({ message: "Reminder signal definition is unavailable" });
							}
							yield* repository.update(captured.id, { triggerId: plan.trigger.id });
							const formatter = plan.runs.find(
								(run) =>
									run.pluginId === null &&
									run.hookSlug === definition.notificationHookSlug &&
									run.executionUserId === userId,
							);
							if (!formatter) {
								return yield* settle(captured, now, "not-sent", "subscription-disabled");
							}
							return yield* repository.update(captured.id, {
								updatedAt: now,
								reconcileAt: now,
								processingAt: now,
								state: "processing",
								formatterRunId: formatter.id,
								revision: captured.revision + 1,
								dispatch: toLifecycleDispatchPlan(plan),
							});
						}),
					},
				});
			});
			const reconcile = Effect.fn("ReminderWorker.reconcile")(function* (
				captured: ReminderRecord,
				now: Date,
			) {
				return yield* transaction(
					Effect.gen(function* () {
						const row = yield* lockCandidate(captured);
						if (row?.state !== "processing" || row.formatterRunId === null) {
							return null;
						}
						yield* repository.update(row.id, {
							reconcileAt: DateTime.toDate(
								DateTime.addDuration(DateTime.makeUnsafe(now), RECONCILE_DELAY_MS),
							),
						});
						const admitted = yield* notifications.listForRun(row.formatterRunId);
						if (admitted.length > 0) {
							for (const notification of admitted) {
								yield* notifications.settle(notification.id, now);
							}
							const current = yield* notifications.listForRun(row.formatterRunId);
							if (current.some((notification) => notification.state !== "settled")) {
								return null;
							}
							const statuses = current.flatMap((notification) =>
								notification.outcome === "partial"
									? ["accepted" as const, "failed" as const]
									: [
											notification.outcome === "not-sent" || notification.outcome === null
												? ("skipped" as const)
												: notification.outcome,
										],
							);
							const outcome = summarizeNotification(statuses);
							let reason: null | ReminderReason = null;
							if (outcome === "not-sent") {
								for (const notification of current) {
									reason ??= notification.reason;
									reason ??=
										(yield* notifications.deliveries(notification.id)).find(
											(delivery) => delivery.reason !== null,
										)?.reason ?? null;
								}
							}
							yield* settle(row, now, outcome, reason);
							return null;
						}
						const formatter = yield* runs.findById(AutomationRunId.make(row.formatterRunId));
						if (
							!formatter ||
							DateTime.isLessThanOrEqualTo(
								DateTime.makeUnsafe(formatter.artifactsExpireAt),
								DateTime.fromDateUnsafe(now),
							)
						) {
							yield* settle(row, now, "failed", "formatter-expired");
						} else if (formatter.status === "succeeded") {
							yield* settle(row, now, "failed", "admission-missing");
						} else if (
							(formatter.status === "failed" || formatter.status === "skipped") &&
							formatter.nextAttemptAt === null
						) {
							yield* settle(row, now, "failed", "formatter-failed");
						} else {
							return row.dispatch;
						}
						return null;
					}),
				);
			});
			/** Moves an unsettled reminder's next attempt `RECONCILE_DELAY_MS` past `now`. */
			const defer = (row: ReminderRecord, now: Date) =>
				transaction(
					Effect.gen(function* () {
						const current = yield* lockCandidate(row);
						if (current && (current.state === "scheduled" || current.state === "processing")) {
							yield* repository.update(row.id, {
								reconcileAt: DateTime.toDate(
									DateTime.addDuration(DateTime.makeUnsafe(now), RECONCILE_DELAY_MS),
								),
							});
						}
					}),
				).pipe(Effect.catchCause((failure) => Effect.logWarning("Reminder deferral failed", failure)));
			const run = Effect.fn("ReminderWorker.run")(function* () {
				if (config.scheduler.disableDispatchers) {
					return;
				}
				const now = yield* DateTime.nowAsDate;
				for (const processing of [false, true]) {
					let after: null | { id: string; reconcileAt: Date } = null;
					for (let page = 0; page < REMINDER_PAGE_LIMIT; page++) {
						const rows: ReadonlyArray<ReminderRecord> = yield* processing
							? repository.listProcessing(now, after)
							: repository.listDue(now, after);
						if (rows.length === 0) {
							break;
						}
						for (const row of rows) {
							yield* Effect.gen(function* () {
								if (processing) {
									const dispatch = yield* reconcile(row, now);
									if (dispatch !== null) {
										yield* execution.dispatch([dispatch]);
									}
								} else {
									yield* admitDue(row, now);
								}
							}).pipe(
								Effect.catchTag("KernelSignalBlocked", ({ reason }) =>
									Effect.logInfo("Reminder deferred: its signal was blocked").pipe(
										Effect.annotateLogs({ reminderId: row.id, reason: reason.code }),
										Effect.andThen(defer(row, now)),
									),
								),
								Effect.catchCause((cause) =>
									Effect.logWarning("Reminder processing deferred", cause).pipe(
										Effect.annotateLogs({ reminderId: row.id }),
										Effect.andThen(defer(row, now)),
									),
								),
							);
						}
						const last = rows.at(-1);
						after = last?.reconcileAt ? { id: last.id, reconcileAt: last.reconcileAt } : null;
					}
				}
			});
			return { run };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
