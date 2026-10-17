import { PgClient } from "@effect/sql-pg";
import type { UserId } from "@ryot-app/contract/schema/brands";
import { sql } from "drizzle-orm";
import * as PgDrizzle from "drizzle-orm/effect-postgres";
import { Cause, Context, Data, Effect, Layer, Pool } from "effect";
import { ConnectionError, SqlError } from "effect/sql/SqlError";

import { mapDatabaseErrors } from "./errors";
import { PgClientLive } from "./postgres";

export const DatabaseConnectionLimit = Context.Reference<
	Pool.Pool<PgClient.PgClient, SqlError> | undefined
>("DatabaseSession.ConnectionLimit", { defaultValue: () => undefined });

export class DatabaseSessionStateError extends Data.TaggedError("DatabaseSessionStateError")<{
	readonly reason: "transaction-already-active" | "transaction-required";
}> {}

export const userWriteLockStatement = (userId: UserId) => (db: PgDrizzle.EffectPgDatabase) =>
	db.execute(sql`select pg_advisory_xact_lock(hashtext(${`user-write:${userId}`}))`);

export class DatabaseSession extends Context.Service<DatabaseSession>()("DatabaseSession", {
	make: Effect.gen(function* () {
		const root = yield* PgDrizzle.makeWithDefaults();
		const connectionExecutor = Context.Reference<PgDrizzle.EffectPgDatabase | null>(
			"DatabaseSession.ConnectionExecutor",
			{ defaultValue: () => null },
		);
		const transactionExecutor = Context.Reference<PgDrizzle.EffectPgDatabase | null>(
			"DatabaseSession.TransactionExecutor",
			{ defaultValue: () => null },
		);
		const withExecutor = Effect.fnUntraced(function* <A, E, R>(
			operation: (db: PgDrizzle.EffectPgDatabase) => Effect.Effect<A, E, R>,
		) {
			const connection = yield* connectionExecutor;
			const transaction = yield* transactionExecutor;
			const existing = transaction ?? connection;
			if (existing !== null) {
				return yield* operation(existing);
			}
			const limit = yield* DatabaseConnectionLimit;
			if (limit === undefined) {
				return yield* operation(root);
			}
			return yield* Effect.scoped(
				Effect.gen(function* () {
					const client = yield* Pool.get(limit);
					const executor = yield* PgDrizzle.makeWithDefaults().pipe(
						Effect.provideService(PgClient.PgClient, client),
					);
					return yield* operation(executor).pipe(
						Effect.provideService(connectionExecutor, executor),
						Effect.onError((cause) =>
							cause.reasons.some(
								(reason) =>
									Cause.isFailReason(reason) &&
									reason.error instanceof SqlError &&
									reason.error.reason instanceof ConnectionError,
							)
								? Pool.invalidate(limit, client)
								: Effect.void,
						),
					);
				}),
			);
		});
		const run = <A, E, R>(operation: (db: PgDrizzle.EffectPgDatabase) => Effect.Effect<A, E, R>) =>
			mapDatabaseErrors(withExecutor(operation));
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
					withExecutor((db) =>
						db.transaction((executor) =>
							work.pipe(Effect.provideService(transactionExecutor, executor)),
						),
					),
				);
			});
		return {
			run,
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
