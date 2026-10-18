import { DbError } from "@ryot-app/contract/errors";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { and, asc, eq, inArray, lt, notExists, or, sql } from "drizzle-orm";
import { alias, type AnyPgColumn } from "drizzle-orm/pg-core";
import { Context, DateTime, Effect, Layer } from "effect";

import { DatabaseSession } from "#platform/db/session";
import { backgroundWork } from "#schema/tables/background-work";
import { eventStreamWork } from "#schema/tables/event-streams";
import { relationshipProjectionWork } from "#schema/tables/relationship-projections";
import { workflowExecution } from "#schema/tables/workflow-executions";

export type BackgroundWorkScopeKey = Pick<
	typeof backgroundWork.$inferSelect,
	"scope" | "userId" | "purpose" | "pluginId"
>;

export const backgroundWorkScopeIdentity = (key: BackgroundWorkScopeKey) =>
	stableStringify([key.userId, key.pluginId, key.purpose, key.scope]);

const sameScope = (
	table: Record<keyof BackgroundWorkScopeKey, AnyPgColumn>,
	key: { [K in keyof BackgroundWorkScopeKey]: AnyPgColumn | BackgroundWorkScopeKey[K] },
) =>
	and(
		eq(table.userId, key.userId),
		eq(table.pluginId, key.pluginId),
		eq(table.purpose, key.purpose),
		eq(table.scope, key.scope),
	);

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
				const [row] = yield* session.run((db) =>
					db
						.select()
						.from(backgroundWork)
						.where(and(eq(backgroundWork.id, id), eq(backgroundWork.status, "running"))),
				);
				return row ?? null;
			});
			const lockScope = Effect.fn("BackgroundWorkRepository.lockScope")(function* (
				key: BackgroundWorkScopeKey,
			) {
				yield* session.run((db) =>
					db.execute(
						sql`select pg_advisory_xact_lock(hashtext(${`background-work:${backgroundWorkScopeIdentity(key)}`}))`,
					),
				);
			});
			const running = Effect.fn("BackgroundWorkRepository.running")(function* (
				key: BackgroundWorkScopeKey,
			) {
				const [row] = yield* session.run((db) =>
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
						.where(and(sameScope(backgroundWork, key), eq(backgroundWork.status, "running")))
						.orderBy(asc(backgroundWork.createdAt), asc(backgroundWork.id))
						.limit(1),
				);
				return row ?? null;
			});
			const claim = Effect.fn("BackgroundWorkRepository.claim")(function* (
				key: BackgroundWorkScopeKey,
			) {
				const [head] = yield* session.run((db) =>
					db
						.select({ id: backgroundWork.id })
						.from(backgroundWork)
						.where(and(sameScope(backgroundWork, key), eq(backgroundWork.status, "queued")))
						.orderBy(asc(backgroundWork.createdAt), asc(backgroundWork.id))
						.limit(1),
				);
				if (!head) {
					return null;
				}
				const updatedAt = yield* DateTime.nowAsDate;
				const [row] = yield* session.run((db) =>
					db
						.update(backgroundWork)
						.set({ updatedAt, status: "running" })
						.where(and(eq(backgroundWork.id, head.id), eq(backgroundWork.status, "queued")))
						.returning({ id: backgroundWork.id }),
				);
				return row?.id ?? null;
			});
			const settle = Effect.fn("BackgroundWorkRepository.settle")(function* (
				id: string,
				status: "failed" | "succeeded",
				error: null | string = null,
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
				const scopeColumns = {
					scope: backgroundWork.scope,
					userId: backgroundWork.userId,
					purpose: backgroundWork.purpose,
					pluginId: backgroundWork.pluginId,
				};
				const sibling = alias(backgroundWork, "sibling");
				const sameKey = sameScope(sibling, scopeColumns);
				const heads = yield* session.run((db) =>
					db
						.select(scopeColumns)
						.from(backgroundWork)
						.where(eq(backgroundWork.status, "running"))
						.orderBy(asc(backgroundWork.updatedAt), asc(backgroundWork.id))
						.limit(limit),
				);
				const waiting = yield* session.run((db) =>
					db
						.select(scopeColumns)
						.from(backgroundWork)
						.where(
							and(
								eq(backgroundWork.status, "queued"),
								notExists(
									db
										.select({ one: sql`1` })
										.from(sibling)
										.where(and(sameKey, eq(sibling.status, "running"))),
								),
								notExists(
									db
										.select({ one: sql`1` })
										.from(sibling)
										.where(
											and(
												sameKey,
												eq(sibling.status, "queued"),
												or(
													lt(sibling.createdAt, backgroundWork.createdAt),
													and(
														eq(sibling.createdAt, backgroundWork.createdAt),
														lt(sibling.id, backgroundWork.id),
													),
												),
											),
										),
								),
							),
						)
						.orderBy(asc(backgroundWork.updatedAt), asc(backgroundWork.id))
						.limit(limit),
				);
				return [...heads, ...waiting];
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
			// Plugins read a scope's latest status, and stream work retries its current job.
			const pruneSettled = Effect.fn("BackgroundWorkRepository.pruneSettled")(function* (
				limit: number,
			) {
				const cutoff = DateTime.formatIso(DateTime.subtract(yield* DateTime.now, { hours: 168 }));
				const rows = yield* session.run((db) =>
					db.execute<{ id: string }>(
						sql`delete from ${backgroundWork} where id in (
							select work.id from ${backgroundWork} work
							where work.status in ('succeeded', 'failed')
								and work.updated_at < ${cutoff}::timestamptz
								and exists (
									select 1 from ${backgroundWork} newer
									where newer.user_id = work.user_id and newer.plugin_id = work.plugin_id
										and newer.purpose = work.purpose and newer.scope = work.scope
										and (newer.created_at, newer.id) > (work.created_at, work.id)
								)
								and not exists (
									select 1 from ${eventStreamWork} stream where stream.current_job_id = work.id
								)
								and not exists (
									select 1 from ${relationshipProjectionWork} projection
									where projection.current_job_id = work.id
								)
							order by work.updated_at
							limit ${limit}
							for update skip locked
						) returning id`,
						"objects",
					),
				);
				return rows.length;
			});
			return {
				get,
				start,
				claim,
				settle,
				request,
				running,
				pending,
				lockScope,
				dispatched,
				pruneSettled,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
