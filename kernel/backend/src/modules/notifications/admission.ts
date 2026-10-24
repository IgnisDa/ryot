import { DbError } from "@ryot-app/contract/errors";
import type { AccountGeneration } from "@ryot-app/contract/schema/account-generation";
import { UserId } from "@ryot-app/contract/schema/brands";
import { Context, DateTime, Effect, Layer } from "effect";
import { WorkflowEngine } from "effect/workflow/WorkflowEngine";

import { MutationReceipts } from "#modules/mutations/receipts";
import { dispatchAdmittedWorkflow } from "#modules/mutations/workflow-dispatch";
import { DatabaseSession } from "#platform/db/session";

import { NotificationDeliveryRepository } from "./delivery-repository";
import {
	NOTIFICATION_CHANNEL_LIMIT,
	NOTIFICATION_RECOVERY_PAGE_LIMIT,
	type NotificationAdmission,
} from "./ledger";
import { NotificationDeliveryWorkflow } from "./notification-delivery-workflow";
import { NotificationsRepository } from "./repository";
import { NotificationSourcePolicy } from "./source-policy";

export class NotificationAdmissions extends Context.Service<NotificationAdmissions>()(
	"NotificationAdmissions",
	{
		make: Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const receipts = yield* MutationReceipts;
			const repository = yield* NotificationDeliveryRepository;
			const channels = yield* NotificationsRepository;
			const engine = yield* WorkflowEngine;
			const sources = yield* NotificationSourcePolicy;
			const dispatch = Effect.fn("NotificationAdmissions.dispatch")(function* (
				id: string,
				account: AccountGeneration,
				executionId: string,
			) {
				return yield* dispatchAdmittedWorkflow(
					receipts,
					engine,
					NotificationDeliveryWorkflow,
					account,
					{
						executionId,
						discard: true,
						payload: { executionId, notificationId: id, accountGeneration: account },
					},
					(registration) => registration,
					(execution) => execution,
				);
			});
			const admit = Effect.fn("NotificationAdmissions.admit")(function* (
				input: NotificationAdmission,
			) {
				if (input.userId !== input.accountGeneration.userId) {
					return yield* new DbError({
						message: "Notification recipient does not match its account authority",
					});
				}
				const now = yield* DateTime.nowAsDate;
				const id = yield* session.transaction(
					Effect.gen(function* () {
						yield* receipts.admitAccount(input.accountGeneration);
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
						return source.id;
					}),
				);
				yield* dispatch(id, input.accountGeneration, `${id}-delivery`).pipe(
					Effect.catchCause((cause) =>
						Effect.logWarning("Notification admitted; dispatch deferred", cause),
					),
				);
				return { id };
			});
			const recover = Effect.fn("NotificationAdmissions.recover")(function* () {
				const now = yield* DateTime.nowAsDate;
				let after: null | { id: string; recoverAt: Date } = null;
				for (let page = 0; page < NOTIFICATION_RECOVERY_PAGE_LIMIT; page++) {
					const rows: Effect.Success<ReturnType<typeof repository.listPending>> =
						yield* repository.listPending(after, now);
					if (rows.length === 0) {
						break;
					}
					for (const row of rows) {
						yield* Effect.gen(function* () {
							const account = { token: row.accountGeneration, userId: UserId.make(row.userId) };
							yield* session.transaction(
								Effect.gen(function* () {
									yield* receipts.admitAccount(account);
									yield* repository.settle(row.id, now);
									yield* repository.deferRecovery(row.id, now);
								}),
							);
							const current = yield* repository.find(row.id);
							if (current?.state === "admitted") {
								yield* dispatch(row.id, account, `${row.id}-recovery-${now.getTime()}`);
							}
						}).pipe(
							Effect.catchCause((cause) =>
								Effect.logWarning("Notification recovery deferred", cause),
							),
						);
					}
					after = rows.at(-1) ?? null;
				}
				yield* repository.pruneDiagnostics(now);
			});
			return { admit, recover };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
