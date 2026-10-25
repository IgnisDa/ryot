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

import { rootLifecycleCommand } from "#modules/automations/lifecycle/command";
import { LifecycleExecution } from "#modules/automations/lifecycle/execution";
import { toLifecycleDispatchPlan } from "#modules/automations/lifecycle/planning";
import { AutomationRunRepository } from "#modules/automations/run-repository";
import { SignalEmissionService } from "#modules/automations/signal-service";
import { DefinitionRepository } from "#modules/definitions/repository";
import { EntitiesRepository } from "#modules/entities/repository";
import { MutationReceipts } from "#modules/mutations/receipts";
import { NotificationDeliveryRepository } from "#modules/notifications/delivery-repository";
import { summarizeNotification } from "#modules/notifications/ledger";
import { PluginRepository } from "#modules/plugins/packages/repository";
import { AppConfig } from "#platform/config/service";
import { DatabaseSession } from "#platform/db/session";

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
			const receipts = yield* MutationReceipts;
			const entities = yield* EntitiesRepository;
			const plugins = yield* PluginRepository;
			const definitions = yield* DefinitionRepository;
			const signals = yield* SignalEmissionService;
			const execution = yield* LifecycleExecution;
			const notifications = yield* NotificationDeliveryRepository;
			const runs = yield* AutomationRunRepository;
			const config = yield* AppConfig;
			const transaction = <A, E, R>(work: Effect.Effect<A, E, R>) =>
				session.transaction(work).pipe(Effect.catchTag("DatabaseSessionStateError", Effect.die));
			const lockCandidate = Effect.fnUntraced(function* (captured: ReminderRecord) {
				const userId = UserId.make(captured.userId);
				yield* receipts.admitAccount({ userId, token: captured.accountGeneration });
				yield* plugins.lockIngestionShared();
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
				return yield* transaction(
					Effect.gen(function* () {
						const row = yield* lockCandidate(captured);
						if (
							row?.state !== "scheduled" ||
							row.dueAt === null ||
							row.dueAt > now ||
							row.entityId === null ||
							row.message === null ||
							row.entityTitle === null ||
							row.timezone === null
						) {
							return null;
						}
						const userId = UserId.make(row.userId);
						const reference = {
							owner: { kind: "kernel" as const },
							slug: SignalSchemaSlug.make("reminder.due"),
						};
						const definition = yield* definitions.findGlobalSignalSchema(reference);
						if (!definition) {
							return yield* new DbError({ message: "Reminder signal definition is unavailable" });
						}
						const command = rootLifecycleCommand({
							lane: "background",
							source: "scheduler",
							itemIdentity: row.id,
							occurredAt: now.toISOString(),
							initiator: { id: userId, kind: "user" },
							accountGeneration: { userId, token: row.accountGeneration },
							executionId: AutomationExecutionId.make(`reminder-due:${row.id}`),
						});
						const plan = yield* signals.planSignal({
							reference,
							principal: { userId, kind: "user" },
							command: { ...command, writeContext: null },
							subjectEntityId: EntityId.make(row.entityId),
							properties: {
								reminderId: row.id,
								message: row.message,
								timezone: row.timezone,
								entityTitle: row.entityTitle,
								dueAt: row.dueAt.toISOString(),
							},
						});
						if (plan.trigger.blockedReason !== null) {
							return yield* new DbError({ message: "Reminder signal planning was blocked" });
						}
						yield* repository.update(row.id, { triggerId: plan.trigger.id });
						const formatter = plan.runs.find(
							(run) =>
								run.pluginId === null &&
								run.hookSlug === definition.notificationHookSlug &&
								run.executionUserId === userId,
						);
						if (!formatter) {
							yield* settle(row, now, "not-sent", "subscription-disabled");
							return null;
						}
						const dispatch = toLifecycleDispatchPlan(plan);
						yield* repository.update(row.id, {
							dispatch,
							updatedAt: now,
							reconcileAt: now,
							processingAt: now,
							state: "processing",
							revision: row.revision + 1,
							formatterRunId: formatter.id,
						});
						return dispatch;
					}),
				);
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
						if (!formatter || Date.parse(formatter.artifactsExpireAt) <= now.getTime()) {
							yield* settle(row, now, "failed", "formatter-expired");
						} else if (formatter.status === "succeeded") {
							yield* settle(row, now, "failed", "admission-missing");
						} else if (
							(formatter.status === "failed" ||
								formatter.status === "rejected" ||
								formatter.status === "skipped") &&
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
								const dispatch = yield* processing ? reconcile(row, now) : admitDue(row, now);
								if (dispatch !== null) {
									yield* execution.dispatch([dispatch]);
								}
							}).pipe(
								Effect.catchCause((cause) =>
									Effect.gen(function* () {
										yield* Effect.logWarning("Reminder processing deferred", cause).pipe(
											Effect.annotateLogs({ reminderId: row.id }),
										);
										yield* transaction(
											Effect.gen(function* () {
												const current = yield* lockCandidate(row);
												if (
													current &&
													(current.state === "scheduled" || current.state === "processing")
												) {
													yield* repository.update(row.id, {
														reconcileAt: DateTime.toDate(
															DateTime.addDuration(DateTime.makeUnsafe(now), RECONCILE_DELAY_MS),
														),
													});
												}
											}),
										).pipe(
											Effect.catchCause((failure) =>
												Effect.logWarning("Reminder deferral failed", failure),
											),
										);
									}),
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
