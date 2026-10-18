import { DbError } from "@ryot-app/contract/errors";
import { and, asc, eq, inArray } from "drizzle-orm";
import { Context, DateTime, Effect, Layer } from "effect";

import { DatabaseSession } from "#platform/db/session";
import { backgroundWork } from "#schema/tables/background-work";
import { workflowExecution } from "#schema/tables/workflow-executions";

export class BackgroundWorkRepository extends Context.Service<BackgroundWorkRepository>()(
	"BackgroundWorkRepository",
	{
		make: Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const request = Effect.fn("BackgroundWorkRepository.request")(function* (
				row: typeof backgroundWork.$inferInsert,
			) {
				yield* session.run((db) => db.insert(backgroundWork).values(row).onConflictDoNothing());
				const stored = yield* get(row.id);
				if (
					!stored ||
					stored.inputHash !== row.inputHash ||
					stored.userId !== row.userId ||
					stored.pluginId !== row.pluginId ||
					stored.accountToken !== row.accountToken ||
					stored.scope !== row.scope ||
					stored.purpose !== row.purpose ||
					stored.key !== row.key
				) {
					return yield* new DbError({ message: "Work key reused with different input" });
				}
				return stored.status;
			});
			const get = Effect.fn("BackgroundWorkRepository.get")(function* (id: string) {
				const [row] = yield* session.run((db) =>
					db.select().from(backgroundWork).where(eq(backgroundWork.id, id)),
				);
				return row ?? null;
			});
			const start = Effect.fn("BackgroundWorkRepository.start")(function* (id: string) {
				const updatedAt = yield* DateTime.nowAsDate;
				const [row] = yield* session.run((db) =>
					db
						.update(backgroundWork)
						.set({ updatedAt, status: "running" })
						.where(
							and(eq(backgroundWork.id, id), inArray(backgroundWork.status, ["queued", "running"])),
						)
						.returning(),
				);
				return row ?? null;
			});
			const settle = Effect.fn("BackgroundWorkRepository.settle")(function* (
				id: string,
				status: "succeeded" | "failed",
				error: string | null = null,
			) {
				const updatedAt = yield* DateTime.nowAsDate;
				const rows = yield* session.run((db) =>
					db
						.update(backgroundWork)
						.set({ error, status, updatedAt })
						.where(
							and(eq(backgroundWork.id, id), inArray(backgroundWork.status, ["queued", "running"])),
						)
						.returning({ id: backgroundWork.id }),
				);
				return rows.length > 0;
			});
			const pending = Effect.fn("BackgroundWorkRepository.pending")(function* (limit = 100) {
				return yield* session.run((db) =>
					db
						.select({
							job: backgroundWork,
							expiredAt: workflowExecution.expiredAt,
							workflowStatus: workflowExecution.status,
						})
						.from(backgroundWork)
						.leftJoin(
							workflowExecution,
							and(
								eq(workflowExecution.workflowName, "BackgroundWorkWorkflow"),
								eq(workflowExecution.executionId, backgroundWork.id),
							),
						)
						.where(inArray(backgroundWork.status, ["queued", "running"]))
						.orderBy(asc(backgroundWork.updatedAt), asc(backgroundWork.id))
						.limit(limit),
				);
			});
			const dispatched = Effect.fn("BackgroundWorkRepository.dispatched")(function* (id: string) {
				const updatedAt = yield* DateTime.nowAsDate;
				yield* session.run((db) =>
					db
						.update(backgroundWork)
						.set({ updatedAt })
						.where(
							and(eq(backgroundWork.id, id), inArray(backgroundWork.status, ["queued", "running"])),
						),
				);
			});
			return { get, start, settle, request, pending, dispatched };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
