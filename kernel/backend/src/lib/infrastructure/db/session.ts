import type { UserId } from "@ryot-app/contract/schema/brands";
import { sql } from "drizzle-orm";
import * as PgDrizzle from "drizzle-orm/effect-postgres";
import { Context, Data, Effect, Layer } from "effect";

import { mapDatabaseErrors } from "./errors";
import { PgClientLive } from "./postgres";

export class DatabaseSessionStateError extends Data.TaggedError("DatabaseSessionStateError")<{
	readonly reason: "transaction-already-active" | "transaction-required";
}> {}

export const userWriteLockStatement = (userId: UserId) => (db: PgDrizzle.EffectPgDatabase) =>
	db.execute(sql`select pg_advisory_xact_lock(hashtext(${`user-write:${userId}`}))`);

export class DatabaseSession extends Context.Service<DatabaseSession>()("DatabaseSession", {
	make: Effect.gen(function* () {
		const root = yield* PgDrizzle.makeWithDefaults();
		const transactionExecutor = Context.Reference<PgDrizzle.EffectPgDatabase | null>(
			"DatabaseSession.TransactionExecutor",
			{ defaultValue: () => null },
		);
		const current = Effect.map(transactionExecutor, (executor) => executor ?? root);
		const run = <A, E, R>(statement: (db: PgDrizzle.EffectPgDatabase) => Effect.Effect<A, E, R>) =>
			mapDatabaseErrors(Effect.flatMap(current, statement));
		const acquireUserWriteLock = Effect.fn("acquireUserWriteLock")(function* (userId: UserId) {
			yield* run(userWriteLockStatement(userId));
		});
		const isTransactionActive = Effect.map(transactionExecutor, (executor) => executor !== null);
		const requireRoot = Effect.flatMap(isTransactionActive, (active) =>
			active
				? Effect.fail(new DatabaseSessionStateError({ reason: "transaction-already-active" }))
				: Effect.void,
		);
		const requireTransaction = Effect.flatMap(isTransactionActive, (active) =>
			active
				? Effect.void
				: Effect.fail(new DatabaseSessionStateError({ reason: "transaction-required" })),
		);
		const transaction = <A, E, R>(work: Effect.Effect<A, E, R>) =>
			Effect.gen(function* () {
				yield* requireRoot;
				return yield* mapDatabaseErrors(
					root.transaction((executor) =>
						work.pipe(Effect.provideService(transactionExecutor, executor)),
					),
				);
			});
		return {
			run,
			current,
			requireRoot,
			transaction,
			requireTransaction,
			isTransactionActive,
			acquireUserWriteLock,
		};
	}),
}) {
	static readonly layer = Layer.effect(this, this.make).pipe(Layer.provide(PgClientLive));
}

export const setLocalStatementTimeout = (timeoutMs: number) =>
	Effect.gen(function* () {
		const session = yield* DatabaseSession;
		yield* session.run((db) =>
			db.execute(sql`SELECT set_config('statement_timeout', ${timeoutMs.toString()}, true)`),
		);
	});
