import { DbError } from "@ryot-app/contract/errors";
import type { AccountGeneration } from "@ryot-app/contract/schema/account-generation";
import type { EntityId, UserId } from "@ryot-app/contract/schema/brands";
import { and, asc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";

import { DatabaseSession } from "#platform/db/session";
import { reminder } from "#schema/tables/reminders";

export const REMINDER_BATCH_SIZE = 50;
export const REMINDER_PAGE_LIMIT = 10;

export class RemindersRepository extends Context.Service<RemindersRepository>()(
	"@ryot-app/kernel-backend/modules/reminders/repository/RemindersRepository",
	{
		make: Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const requireTransaction = session.requireTransaction.pipe(
				Effect.mapError(() => new DbError({ message: "Reminder write requires a transaction" })),
			);
			const findForUser = Effect.fn("RemindersRepository.findForUser")(function* (
				userId: UserId,
				id: string,
			) {
				const [row] = yield* session.run((db) =>
					db
						.select()
						.from(reminder)
						.where(and(eq(reminder.id, id), eq(reminder.userId, userId))),
				);
				return row ?? null;
			});
			const lockForUser = Effect.fn("RemindersRepository.lockForUser")(function* (
				userId: UserId,
				id: string,
			) {
				yield* requireTransaction;
				const [row] = yield* session.run((db) =>
					db
						.select()
						.from(reminder)
						.where(and(eq(reminder.id, id), eq(reminder.userId, userId)))
						.for("update"),
				);
				return row ?? null;
			});
			const insert = Effect.fn("RemindersRepository.insert")(function* (
				values: typeof reminder.$inferInsert,
			) {
				yield* requireTransaction;
				yield* session.run((db) => db.insert(reminder).values(values));
			});
			const update = Effect.fn("RemindersRepository.update")(function* (
				id: string,
				values: Partial<typeof reminder.$inferInsert>,
			) {
				yield* requireTransaction;
				yield* session.run((db) => db.update(reminder).set(values).where(eq(reminder.id, id)));
			});
			const authorizeRun = Effect.fn("RemindersRepository.authorizeRun")(function* (input: {
				runId: null | string;
				accountGeneration: AccountGeneration;
			}) {
				yield* requireTransaction;
				const runId = input.runId;
				if (runId === null) {
					return true;
				}
				const [row] = yield* session.run((db) =>
					db.select().from(reminder).where(eq(reminder.formatterRunId, runId)).for("update"),
				);
				return (
					row === undefined ||
					(row.state === "processing" &&
						row.removedAt === null &&
						row.userId === input.accountGeneration.userId &&
						row.accountGeneration === input.accountGeneration.token)
				);
			});
			const listForEntities = Effect.fn("RemindersRepository.listForEntities")(function* (input: {
				userId?: UserId;
				entityIds: ReadonlyArray<EntityId>;
			}) {
				if (input.entityIds.length === 0) {
					return [];
				}
				return yield* session.run((db) =>
					db
						.select()
						.from(reminder)
						.where(
							and(
								isNull(reminder.removedAt),
								input.userId === undefined ? undefined : eq(reminder.userId, input.userId),
								or(
									inArray(reminder.entityId, [...input.entityIds]),
									inArray(reminder.parentEntityId, [...input.entityIds]),
								),
							),
						)
						.orderBy(asc(reminder.id)),
				);
			});
			const listDue = (now: Date, after: null | { id: string; reconcileAt: Date }) =>
				session.run((db) =>
					db
						.select()
						.from(reminder)
						.where(
							and(
								eq(reminder.state, "scheduled"),
								isNull(reminder.removedAt),
								lte(reminder.dueAt, now),
								lte(reminder.reconcileAt, now),
								after
									? or(
											sql`${reminder.reconcileAt} > ${after.reconcileAt}`,
											and(
												eq(reminder.reconcileAt, after.reconcileAt),
												sql`${reminder.id} > ${after.id}`,
											),
										)
									: undefined,
							),
						)
						.orderBy(asc(reminder.reconcileAt), asc(reminder.id))
						.limit(REMINDER_BATCH_SIZE),
				);
			const listProcessing = (now: Date, after: null | { id: string; reconcileAt: Date }) =>
				session.run((db) =>
					db
						.select()
						.from(reminder)
						.where(
							and(
								eq(reminder.state, "processing"),
								lte(reminder.reconcileAt, now),
								after
									? or(
											sql`${reminder.reconcileAt} > ${after.reconcileAt}`,
											and(
												eq(reminder.reconcileAt, after.reconcileAt),
												sql`${reminder.id} > ${after.id}`,
											),
										)
									: undefined,
							),
						)
						.orderBy(asc(reminder.reconcileAt), asc(reminder.id))
						.limit(REMINDER_BATCH_SIZE),
				);
			return {
				insert,
				update,
				listDue,
				findForUser,
				lockForUser,
				authorizeRun,
				listProcessing,
				listForEntities,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
