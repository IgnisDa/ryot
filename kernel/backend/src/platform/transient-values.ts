import { and, eq, sql } from "drizzle-orm";
import type { EffectPgDatabase } from "drizzle-orm/effect-postgres";
import { Context, Duration, Effect, Layer } from "effect";

import { DatabaseSession } from "#platform/db/session";
import { transientValue as table } from "#schema/tables/transient-values";

const live = sql`(${table.expiresAt} is null or ${table.expiresAt} > now())`;

const expiry = (ttl: undefined | Duration.Input) =>
	ttl === undefined
		? null
		: sql`now() + ${Duration.toMillis(Duration.fromInputUnsafe(ttl))} * interval '1 millisecond'`;

/**
 * Values that may expire, such as tickets, leases and script caches. Each call commits by itself, because these
 * outlive the transaction of whichever request touched them.
 */
export class TransientValues extends Context.Service<TransientValues>()(
	"@ryot-app/kernel-backend/platform/transient-values/TransientValues",
	{
		make: Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const run = <A, E>(operation: (db: EffectPgDatabase) => Effect.Effect<A, E>) =>
				session.detached(session.run(operation));

			const get = Effect.fn("TransientValues.get")(function* (key: string) {
				const [row] = yield* run((db) =>
					db
						.select({ value: table.value })
						.from(table)
						.where(and(eq(table.key, key), live)),
				);
				return row?.value ?? null;
			});

			const set = Effect.fn("TransientValues.set")(function* (
				key: string,
				value: string,
				ttl?: Duration.Input,
			) {
				const expiresAt = expiry(ttl);
				yield* run((db) =>
					db
						.insert(table)
						.values({ key, value, expiresAt })
						.onConflictDoUpdate({ target: table.key, set: { value, expiresAt } }),
				);
			});

			/** Stores the value unless a live one holds the key, and says whether it did. */
			const setIfAbsent = Effect.fn("TransientValues.setIfAbsent")(function* (
				key: string,
				value: string,
				ttl?: Duration.Input,
			) {
				const expiresAt = expiry(ttl);
				const stored = yield* run((db) =>
					db
						.insert(table)
						.values({ key, value, expiresAt })
						.onConflictDoUpdate({
							target: table.key,
							set: { value, expiresAt },
							setWhere: sql`not ${live}`,
						})
						.returning({ key: table.key }),
				);
				return stored.length > 0;
			});

			/** Replaces the value and returns the live one it replaced. */
			const swap = Effect.fn("TransientValues.swap")(function* (
				key: string,
				value: string,
				ttl?: Duration.Input,
			) {
				const expiresAt = expiry(ttl);
				const rows = yield* run((db) =>
					db.execute<{ previous: null | string }>(
						sql`
						with previous as (select value, expires_at from ${table} where key = ${key} for update),
						written as (
							insert into ${table} (key, value, expires_at) values (${key}, ${value}, ${expiresAt})
							on conflict (key) do update set value = excluded.value, expires_at = excluded.expires_at
						)
						select case when expires_at is null or expires_at > now() then value end as previous from previous
					`,
						"objects",
					),
				);
				return rows[0]?.previous ?? null;
			});

			/** Extends the value's expiry if it is still the one stored, and says whether it was. */
			const renew = Effect.fn("TransientValues.renew")(function* (
				key: string,
				value: string,
				ttl: Duration.Input,
			) {
				const expiresAt = expiry(ttl);
				const renewed = yield* run((db) =>
					db
						.update(table)
						.set({ expiresAt })
						.where(and(eq(table.key, key), eq(table.value, value), live))
						.returning({ key: table.key }),
				);
				return renewed.length > 0;
			});

			const remove = Effect.fn("TransientValues.remove")(function* (key: string) {
				yield* run((db) => db.delete(table).where(eq(table.key, key)));
			});

			const removeIfEquals = Effect.fn("TransientValues.removeIfEquals")(function* (
				key: string,
				value: string,
			) {
				const removed = yield* run((db) =>
					db
						.delete(table)
						.where(and(eq(table.key, key), eq(table.value, value)))
						.returning({ key: table.key }),
				);
				return removed.length > 0;
			});

			/** Removes the value and returns it, so one caller at most ever gets it. */
			const take = Effect.fn("TransientValues.take")(function* (key: string) {
				const [row] = yield* run((db) =>
					db
						.delete(table)
						.where(and(eq(table.key, key), live))
						.returning({ value: table.value }),
				);
				return row?.value ?? null;
			});

			const remainingMillis = Effect.fn("TransientValues.remainingMillis")(function* (key: string) {
				const rows = yield* run((db) =>
					db.execute<{ remaining: null | number }>(
						sql`
						select greatest(0, extract(epoch from expires_at - now()) * 1000)::float8 as remaining
						from ${table} where key = ${key} and ${live}
					`,
						"objects",
					),
				);
				return rows[0]?.remaining ?? null;
			});

			const prune = Effect.fn("TransientValues.prune")(function* (limit: number) {
				yield* run((db) =>
					db.execute(sql`delete from ${table} where key in (
						select key from ${table} where expires_at <= now() order by expires_at limit ${limit}
					)`),
				);
			});

			return {
				get,
				set,
				swap,
				take,
				renew,
				prune,
				remove,
				setIfAbsent,
				removeIfEquals,
				remainingMillis,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
