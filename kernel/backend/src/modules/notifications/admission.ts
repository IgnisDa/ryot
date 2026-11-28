import { DbError } from "@ryot-app/contract/errors";
import { Context, DateTime, Effect, Layer } from "effect";

import { AccountAdmission } from "#modules/mutations/account-admission";
import { DatabaseSession } from "#platform/db/session";
import type { WriteTransaction } from "#platform/db/write-transaction";
import { JobQueue } from "#platform/jobs/queue";

import { NotificationDeliveryJob } from "./delivery-job";
import { NotificationDeliveryRepository } from "./delivery-repository";
import { NOTIFICATION_CHANNEL_LIMIT, type NotificationAdmission } from "./ledger";
import { NotificationsRepository } from "./repository";
import { NotificationSourcePolicy } from "./source-policy";

export class NotificationAdmissions extends Context.Service<NotificationAdmissions>()(
	"@ryot-app/kernel-backend/modules/notifications/admission/NotificationAdmissions",
	{
		make: Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const admission = yield* AccountAdmission.make;
			const repository = yield* NotificationDeliveryRepository;
			const channels = yield* NotificationsRepository;
			const jobs = yield* JobQueue;
			const sources = yield* NotificationSourcePolicy;
			/** Admits within the caller's transaction; the queued delivery job runs after it commits. */
			const admitWithin = Effect.fn("NotificationAdmissions.admitWithin")(function* (
				input: NotificationAdmission,
				transaction?: WriteTransaction,
			) {
				yield* session.requireTransaction.pipe(
					Effect.mapError(
						() => new DbError({ message: "Notification admission requires a transaction" }),
					),
				);
				if (input.userId !== input.accountUserId) {
					return yield* new DbError({
						message: "Notification recipient does not match its account authority",
					});
				}
				const now = yield* DateTime.nowAsDate;
				const id = yield* Effect.gen(function* () {
					yield* admission.admitAccount(input.accountUserId, transaction);
					if (
						!(yield* sources.authorize({
							runId: input.sourceRunId,
							accountUserId: input.accountUserId,
						}))
					) {
						return yield* new DbError({
							message: "Notification source has been cancelled or settled",
						});
					}
					const source = yield* repository.lookupSource(input);
					if (source.existing) {
						return source.id;
					}
					const selected = yield* channels.listEnabledForUser({
						userId: input.userId,
						limit: NOTIFICATION_CHANNEL_LIMIT + 1,
					});
					yield* repository.insert({ ...source, now, admission: input, channels: selected });
					if (selected.length > 0) {
						yield* jobs.enqueue(
							NotificationDeliveryJob,
							{ notificationId: source.id, accountUserId: input.accountUserId },
							{ userId: input.userId },
						);
					}
					return source.id;
				}).pipe(Effect.catchTag("SchemaError", Effect.die));
				return { id };
			});
			const admit = Effect.fn("NotificationAdmissions.admit")(function* (
				input: NotificationAdmission,
			) {
				return yield* session
					.transaction(admitWithin(input))
					.pipe(Effect.catchTag("DatabaseSessionStateError", Effect.die));
			});
			const pruneDiagnostics = Effect.fn("NotificationAdmissions.pruneDiagnostics")(function* () {
				yield* repository.pruneDiagnostics(yield* DateTime.nowAsDate);
			});
			return { admit, admitWithin, pruneDiagnostics };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
