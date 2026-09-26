import type { UserId } from "@ryot-app/contract/schema/brands";
import { and, asc, count, eq, inArray, sql } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { Database, mapDatabaseErrors } from "#lib/infrastructure/db/service";
import { acquireUserWriteLock } from "#lib/infrastructure/db/user-write-lock";

export type ProviderImportAdmissionRow = typeof schema.providerImportAdmission.$inferSelect;

const ADMISSION_LOCK_KEY = "ryot-provider-import-admission";

export class ProviderImportAdmissionRepository extends Context.Service<ProviderImportAdmissionRepository>()(
	"ProviderImportAdmissionRepository",
	{
		make: Effect.sync(() => {
			const table = schema.providerImportAdmission;

			/** Runs inside the caller's transaction; the user lock makes the backlog check exact. */
			const enqueue = Effect.fn("ProviderImportAdmissionRepository.enqueue")(function* (input: {
				id: string;
				userId: UserId;
				payload: unknown;
				externalId: string;
				providerId: string;
				backlogLimit: number;
				entitySchemaSlug: string;
			}) {
				const db = yield* Database;
				yield* acquireUserWriteLock(input.userId);
				const [existing] = yield* mapDatabaseErrors(
					db
						.select({ id: table.id })
						.from(table)
						.where(
							and(
								eq(table.userId, input.userId),
								eq(table.providerId, input.providerId),
								eq(table.externalId, input.externalId),
								eq(table.entitySchemaSlug, input.entitySchemaSlug),
							),
						)
						.limit(1),
				);
				if (existing) {
					return { id: existing.id, status: "duplicate" } as const;
				}
				const [pending] = yield* mapDatabaseErrors(
					db.select({ value: count() }).from(table).where(eq(table.userId, input.userId)),
				);
				if ((pending?.value ?? 0) >= input.backlogLimit) {
					return { status: "backlog-full" } as const;
				}
				yield* mapDatabaseErrors(
					db
						.insert(table)
						.values({
							id: input.id,
							status: "queued",
							userId: input.userId,
							payload: input.payload,
							externalId: input.externalId,
							providerId: input.providerId,
							entitySchemaSlug: input.entitySchemaSlug,
						}),
				);
				return { id: input.id, status: "queued" } as const;
			});

			const find = Effect.fn("ProviderImportAdmissionRepository.find")(function* (input: {
				id: string;
				userId: UserId;
			}) {
				const db = yield* Database;
				const [row] = yield* mapDatabaseErrors(
					db
						.select({ status: table.status })
						.from(table)
						.where(and(eq(table.id, input.id), eq(table.userId, input.userId)))
						.limit(1),
				);
				return row ?? null;
			});

			const listRunning = Effect.fn("ProviderImportAdmissionRepository.listRunning")(function* () {
				const db = yield* Database;
				return yield* mapDatabaseErrors(
					db.select().from(table).where(eq(table.status, "running")).orderBy(asc(table.admittedAt)),
				);
			});

			const hasPending = Effect.fn("ProviderImportAdmissionRepository.hasPending")(function* () {
				const db = yield* Database;
				const [row] = yield* mapDatabaseErrors(db.select({ id: table.id }).from(table).limit(1));
				return row !== undefined;
			});

			/** Deletes the row only while it is still queued, so an admitted import is never lost. */
			const cancelQueued = Effect.fn("ProviderImportAdmissionRepository.cancelQueued")(
				function* (input: { id: string; userId: UserId }) {
					const db = yield* Database;
					const deleted = yield* mapDatabaseErrors(
						db
							.delete(table)
							.where(
								and(
									eq(table.id, input.id),
									eq(table.userId, input.userId),
									eq(table.status, "queued"),
								),
							)
							.returning({ id: table.id }),
					);
					return deleted.length > 0;
				},
			);

			/**
			 * Removes the `finished` imports and promotes queued rows while fewer than `limit` run, under
			 * one installation-wide lock. The next row belongs to the user with the fewest imports running
			 * or finished in this pass, oldest request first, so a finishing import hands its slot to
			 * another user rather than its own next request.
			 */
			const admit = Effect.fn("ProviderImportAdmissionRepository.admit")(function* (input: {
				limit: number;
				finished: ReadonlyArray<string>;
			}) {
				const db = yield* Database;
				yield* mapDatabaseErrors(
					db.execute(sql`select pg_advisory_xact_lock(hashtext(${ADMISSION_LOCK_KEY}))`),
				);
				const served =
					input.finished.length === 0
						? []
						: yield* mapDatabaseErrors(
								db
									.delete(table)
									.where(and(inArray(table.id, [...input.finished]), eq(table.status, "running")))
									.returning({ userId: table.userId }),
							);
				return yield* mapDatabaseErrors(
					db.execute<{ id: string; payload: unknown }>(
						sql`with running as (
							select user_id, count(*)::int as active
							from provider_import_admission
							where status = 'running'
							group by user_id
						), served as (
							select user_id, count(*)::int as finished
							from unnest(array[${sql.join(
								served.map(({ userId }) => sql`${userId}`),
								sql`, `,
							)}]::text[]) as user_id
							group by user_id
						), slots as (
							select greatest(${input.limit} - coalesce(sum(active), 0), 0)::int as available from running
						), ranked as (
							select q.id, q.created_at,
								coalesce(r.active, 0) + coalesce(s.finished, 0)
									+ row_number() over (partition by q.user_id order by q.created_at, q.id) as turn
							from provider_import_admission q
							left join running r on r.user_id = q.user_id
							left join served s on s.user_id = q.user_id
							where q.status = 'queued'
						), chosen as (
							select id from ranked
							order by turn, created_at, id
							limit (select available from slots)
						)
						update provider_import_admission a
						set status = 'running', admitted_at = now()
						from chosen
						where a.id = chosen.id
						returning a.id, a.payload`,
						"objects",
					),
				);
			});

			return { find, admit, enqueue, hasPending, listRunning, cancelQueued };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
