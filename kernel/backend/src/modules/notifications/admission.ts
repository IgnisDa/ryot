import { DbError } from "@ryot-app/contract/errors";
import { Context, DateTime, Effect, Layer } from "effect";

import { AccountAdmission } from "#modules/mutations/account-admission";
import { DatabaseSession } from "#platform/db/session";
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
			const admit = Effect.fn("NotificationAdmissions.admit")(function* (
				input: NotificationAdmission,
			) {
				if (input.userId !== input.accountGeneration.userId) {
					return yield* new DbError({
						message: "Notification recipient does not match its account authority",
					});
				}
				const now = yield* DateTime.nowAsDate;
				const id = yield* session
					.transaction(
						Effect.gen(function* () {
							yield* admission.admitAccount(input.accountGeneration);
							if (
								!(yield* sources.authorize({
									runId: input.sourceRunId,
									accountGeneration: input.accountGeneration,
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
									{ notificationId: source.id, accountGeneration: input.accountGeneration },
									{ userId: input.userId },
								);
							}
							return source.id;
						}),
					)
					.pipe(
						Effect.catchTags({ SchemaError: Effect.die, DatabaseSessionStateError: Effect.die }),
					);
				return { id };
			});
			const pruneDiagnostics = Effect.fn("NotificationAdmissions.pruneDiagnostics")(function* () {
				yield* repository.pruneDiagnostics(yield* DateTime.nowAsDate);
			});
			return { admit, pruneDiagnostics };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
