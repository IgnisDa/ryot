import { DbError } from "@ryot-app/contract/errors";
import type {
	NotificationChannelOutcome,
	NotificationDeliveryReason,
} from "@ryot-app/contract/modules/notifications/delivery";
import {
	NotificationAdmissionConflictError,
	NotificationAdmissionUnavailableError,
} from "@ryot-app/contract/modules/notifications/schemas";
import { sha256Base64Url } from "@ryot-app/ts-utils/crypto";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { and, asc, eq, isNotNull, lt, or, sql } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";

import { DatabaseSession } from "#platform/db/session";
import {
	notification,
	notificationChannel,
	notificationDelivery,
} from "#schema/tables/notifications";

import {
	NOTIFICATION_ABANDONED_AFTER_MS,
	NOTIFICATION_BATCH_SIZE,
	NOTIFICATION_CHANNEL_LIMIT,
	type NotificationAdmission,
	summarizeNotification,
} from "./ledger";
import type { NotificationChannelRecord } from "./repository";

const outcomeReason = (status: NotificationChannelOutcome): null | NotificationDeliveryReason => {
	if (status === "unknown") {
		return "delivery-unknown";
	}
	if (status === "failed") {
		return "provider-rejected";
	}
	if (status === "skipped") {
		return "server-disabled";
	}
	return null;
};

export class NotificationDeliveryRepository extends Context.Service<NotificationDeliveryRepository>()(
	"NotificationDeliveryRepository",
	{
		make: Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const requireTransaction = session.requireTransaction.pipe(
				Effect.mapError(
					() => new DbError({ message: "Notification write requires a transaction" }),
				),
			);
			const find = Effect.fn("NotificationDeliveryRepository.find")(function* (id: string) {
				const [row] = yield* session.run((db) =>
					db.select().from(notification).where(eq(notification.id, id)),
				);
				return row ?? null;
			});
			const lock = Effect.fn("NotificationDeliveryRepository.lock")(function* (id: string) {
				yield* requireTransaction;
				const [row] = yield* session.run((db) =>
					db.select().from(notification).where(eq(notification.id, id)).for("update"),
				);
				return row ?? null;
			});
			const deliveries = (id: string) =>
				session.run((db) =>
					db
						.select()
						.from(notificationDelivery)
						.where(eq(notificationDelivery.notificationId, id))
						.orderBy(asc(notificationDelivery.channelId)),
				);
			const lookupSource = Effect.fn("NotificationDeliveryRepository.lookupSource")(function* (
				input: NotificationAdmission,
			) {
				yield* requireTransaction;
				const id = `notification_${sha256Base64Url(stableStringify([input.userId, input.accountGeneration.token, input.sourceKey]))}`;
				yield* session.run((db) =>
					db.execute(sql`select pg_advisory_xact_lock(hashtext(${`notification-source:${id}`}))`),
				);
				const existing = yield* find(id);
				const inputDigest = sha256Base64Url(stableStringify(input));
				if (existing && existing.inputDigest !== inputDigest) {
					return yield* new NotificationAdmissionConflictError({
						reason: { code: "source-content-conflict" },
					});
				}
				return { id, existing, inputDigest };
			});
			const insert = Effect.fn("NotificationDeliveryRepository.insert")(function* (input: {
				now: Date;
				id: string;
				inputDigest: string;
				admission: NotificationAdmission;
				channels: ReadonlyArray<NotificationChannelRecord>;
			}) {
				yield* requireTransaction;
				if (input.channels.length > NOTIFICATION_CHANNEL_LIMIT) {
					return yield* new NotificationAdmissionUnavailableError({
						reason: { code: "channel-capacity", limit: NOTIFICATION_CHANNEL_LIMIT },
					});
				}
				const noChannels = input.channels.length === 0;
				yield* session.run((db) =>
					db
						.insert(notification)
						.values({
							id: input.id,
							createdAt: input.now,
							recoverAt: input.now,
							userId: input.admission.userId,
							inputDigest: input.inputDigest,
							request: input.admission.request,
							sourceKey: input.admission.sourceKey,
							outcome: noChannels ? "not-sent" : null,
							sourceRunId: input.admission.sourceRunId,
							settledAt: noChannels ? input.now : null,
							state: noChannels ? "settled" : "admitted",
							reason: noChannels ? "no-enabled-channels" : null,
							accountGeneration: input.admission.accountGeneration.token,
						}),
				);
				if (!noChannels) {
					yield* session.run((db) =>
						db
							.insert(notificationDelivery)
							.values(
								input.channels.map((channel) => ({
									channelId: channel.id,
									notificationId: input.id,
									channel: channel.channel,
									status: "queued" as const,
									description: channel.description,
									id: `delivery_${sha256Base64Url(stableStringify([input.id, channel.id]))}`,
								})),
							),
					);
				}
				return yield* Effect.void;
			});
			const claim = Effect.fn("NotificationDeliveryRepository.claim")(function* (input: {
				now: Date;
				channelId: string;
				attemptId: string;
				disabled: boolean;
				notificationId: string;
				sourceAuthorized: boolean;
				preparationFailure?: string;
			}) {
				yield* requireTransaction;
				const row = yield* lock(input.notificationId);
				if (row?.state !== "admitted") {
					return null;
				}
				const [channel] = yield* session.run((db) =>
					db
						.select()
						.from(notificationChannel)
						.where(
							and(
								eq(notificationChannel.id, input.channelId),
								eq(notificationChannel.userId, row.userId),
							),
						)
						.for("share"),
				);
				const skipped = !input.sourceAuthorized || input.disabled || !channel || channel.isDisabled;
				let update: Partial<typeof notificationDelivery.$inferInsert>;
				if (skipped) {
					let reason: NotificationDeliveryReason = "channel-disabled";
					let diagnostic = "Channel disabled";
					if (!input.sourceAuthorized) {
						reason = "source-cancelled";
						diagnostic = "Notification source cancelled or settled";
					} else if (input.disabled) {
						reason = "server-disabled";
						diagnostic = "Server delivery disabled";
					} else if (!channel) {
						reason = "channel-deleted";
						diagnostic = "Channel deleted";
					}
					update = { reason, diagnostic, status: "skipped", settledAt: input.now };
				} else if (input.preparationFailure !== undefined) {
					update = {
						status: "failed",
						settledAt: input.now,
						reason: "preparation-failed",
						diagnostic: input.preparationFailure,
					};
				} else {
					update = { status: "sending", claimedAt: input.now, attemptId: input.attemptId };
				}
				const [claimed] = yield* session.run((db) =>
					db
						.update(notificationDelivery)
						.set(update)
						.where(
							and(
								eq(notificationDelivery.notificationId, input.notificationId),
								eq(notificationDelivery.channelId, input.channelId),
								eq(notificationDelivery.status, "queued"),
							),
						)
						.returning({ id: notificationDelivery.id }),
				);
				return !skipped && input.preparationFailure === undefined && claimed
					? { channel, request: row.request }
					: null;
			});
			const finishAttempt = Effect.fn("NotificationDeliveryRepository.finishAttempt")(
				function* (input: {
					now: Date;
					channelId: string;
					attemptId: string;
					notificationId: string;
					diagnostic: null | string;
					status: NotificationChannelOutcome;
				}) {
					yield* requireTransaction;
					yield* lock(input.notificationId);
					yield* session.run((db) =>
						db
							.update(notificationDelivery)
							.set({
								status: input.status,
								settledAt: input.now,
								diagnostic: input.diagnostic,
								reason: outcomeReason(input.status),
							})
							.where(
								and(
									eq(notificationDelivery.notificationId, input.notificationId),
									eq(notificationDelivery.channelId, input.channelId),
									eq(notificationDelivery.attemptId, input.attemptId),
									eq(notificationDelivery.status, "sending"),
								),
							),
					);
				},
			);
			const settle = Effect.fn("NotificationDeliveryRepository.settle")(function* (
				id: string,
				now: Date,
			) {
				yield* requireTransaction;
				const row = yield* lock(id);
				if (!row || row.state === "settled") {
					return;
				}
				yield* session.run((db) =>
					db
						.update(notificationDelivery)
						.set({
							settledAt: now,
							status: "unknown",
							reason: "delivery-unknown",
							diagnostic: "Send attempt interrupted; provider acceptance is unknown",
						})
						.where(
							and(
								eq(notificationDelivery.notificationId, id),
								eq(notificationDelivery.status, "sending"),
								lt(
									notificationDelivery.claimedAt,
									new Date(now.getTime() - NOTIFICATION_ABANDONED_AFTER_MS),
								),
							),
						),
				);
				const rows = yield* deliveries(id);
				const statuses: Array<NotificationChannelOutcome> = [];
				for (const delivery of rows) {
					if (delivery.status === "queued" || delivery.status === "sending") {
						return;
					}
					statuses.push(delivery.status);
				}
				yield* session.run((db) =>
					db
						.update(notification)
						.set({ settledAt: now, state: "settled", outcome: summarizeNotification(statuses) })
						.where(eq(notification.id, id)),
				);
			});
			const deferRecovery = Effect.fn("NotificationDeliveryRepository.deferRecovery")(function* (
				id: string,
				now: Date,
			) {
				yield* requireTransaction;
				yield* session.run((db) =>
					db
						.update(notification)
						.set({ recoverAt: new Date(now.getTime() + NOTIFICATION_ABANDONED_AFTER_MS) })
						.where(and(eq(notification.id, id), eq(notification.state, "admitted"))),
				);
			});
			const listPending = (after: null | { id: string; recoverAt: Date }, now: Date) =>
				session.run((db) =>
					db
						.select()
						.from(notification)
						.where(
							and(
								eq(notification.state, "admitted"),
								sql`${notification.recoverAt} <= ${now}`,
								after
									? or(
											sql`${notification.recoverAt} > ${after.recoverAt}`,
											and(
												eq(notification.recoverAt, after.recoverAt),
												sql`${notification.id} > ${after.id}`,
											),
										)
									: undefined,
							),
						)
						.orderBy(asc(notification.recoverAt), asc(notification.id))
						.limit(NOTIFICATION_BATCH_SIZE),
				);
			const pruneDiagnostics = Effect.fn("NotificationDeliveryRepository.pruneDiagnostics")(
				function* (now: Date) {
					const rows = yield* session.run((db) =>
						db.execute(
							sql`update ${notificationDelivery} set diagnostic = null where id in (select id from ${notificationDelivery} where ${isNotNull(notificationDelivery.diagnostic)} and ${notificationDelivery.settledAt} < ${new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)} order by ${notificationDelivery.settledAt}, id limit ${NOTIFICATION_BATCH_SIZE} for update skip locked) returning id`,
							"objects",
						),
					);
					return rows.length;
				},
			);
			const listForRun = (runId: string) =>
				session.run((db) =>
					db
						.select()
						.from(notification)
						.where(eq(notification.sourceRunId, runId))
						.orderBy(asc(notification.id)),
				);
			const revokeRun = Effect.fn("NotificationDeliveryRepository.revokeRun")(function* (
				runId: string,
				now: Date,
				eraseContent = false,
			) {
				yield* requireTransaction;
				const rows = yield* listForRun(runId);
				let sendStarted = false;
				for (const row of rows) {
					yield* lock(row.id);
					const attempts = yield* deliveries(row.id);
					sendStarted ||= attempts.some((attempt) => attempt.attemptId !== null);
					yield* session.run((db) =>
						db
							.update(notificationDelivery)
							.set({ settledAt: now, status: "skipped", reason: "source-cancelled" })
							.where(
								and(
									eq(notificationDelivery.notificationId, row.id),
									eq(notificationDelivery.status, "queued"),
								),
							),
					);
					yield* settle(row.id, now);
					if (eraseContent) {
						yield* session.run((db) =>
							db
								.update(notification)
								.set({ request: { message: "", kind: "message" } })
								.where(eq(notification.id, row.id)),
						);
					}
				}
				return sendStarted;
			});
			return {
				find,
				lock,
				claim,
				insert,
				settle,
				revokeRun,
				deliveries,
				listForRun,
				listPending,
				lookupSource,
				deferRecovery,
				finishAttempt,
				pruneDiagnostics,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
