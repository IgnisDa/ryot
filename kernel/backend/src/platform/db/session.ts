import { PgClient } from "@effect/sql-pg";
import type { UserId } from "@ryot-app/contract/schema/brands";
import { sql } from "drizzle-orm";
import * as PgDrizzle from "drizzle-orm/effect-postgres";
import { Cause, Context, Effect, Layer, Pool, Schema } from "effect";
import { ConnectionError, SqlError } from "effect/sql/SqlError";

import { mapDatabaseErrors } from "./errors";
import { PgClientLive } from "./postgres";

export const DatabaseConnectionLimit = Context.Reference<
	undefined | Pool.Pool<PgClient.PgClient, SqlError>
>("DatabaseSession.ConnectionLimit", { defaultValue: () => undefined });

const fiberContext: Effect.Effect<Context.Context<never>> = Effect.context();

export class DatabaseSessionStateError extends Schema.TaggedError<
	DatabaseSessionStateError,
	{ readonly brand: unique symbol }
>()("DatabaseSessionStateError", {
	reason: Schema.Literals(["transaction-required", "transaction-already-active"]),
}) {}

export const userWriteLockStatement = (userId: UserId) => (db: PgDrizzle.EffectPgDatabase) =>
	db.execute(sql`select pg_advisory_xact_lock(hashtext(${`user-write:${userId}`}))`);

export class DatabaseSession extends Context.Service<DatabaseSession>()(
	"@ryot-app/kernel-backend/platform/db/session/DatabaseSession",
	{
		make: Effect.gen(function* () {
			const root = yield* PgDrizzle.makeWithDefaults();
			const sqlClient = yield* PgClient.PgClient;
			const connectionExecutor = Context.Reference<null | PgDrizzle.EffectPgDatabase>(
				"DatabaseSession.ConnectionExecutor",
				{ defaultValue: () => null },
			);
			const transactionExecutor = Context.Reference<null | PgDrizzle.EffectPgDatabase>(
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
			const run = <A, E, R>(
				operation: (db: PgDrizzle.EffectPgDatabase) => Effect.Effect<A, E, R>,
			) => mapDatabaseErrors(withExecutor(operation));
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
			const savepoint = <A, E, R>(work: Effect.Effect<A, E, R>) =>
				Effect.gen(function* () {
					const current = yield* transactionExecutor;
					if (current === null) {
						return yield* new DatabaseSessionStateError({ reason: "transaction-required" });
					}
					return yield* mapDatabaseErrors(
						current.transaction((executor) =>
							work.pipe(Effect.provideService(transactionExecutor, executor)),
						),
					);
				});
			// A sandbox run settles host calls on fibers its caller did not start. The SQL client finds a
			// transaction's connection in fiber context, so those fibers need the caller's entries as well as
			// these executors; a fiber's own entries win, so it keeps the services it was given.
			const carry = Effect.map(
				Effect.all([transactionExecutor, connectionExecutor, fiberContext]),
				([current, connection, caller]) =>
					<A, E, R>(work: Effect.Effect<A, E, R>) =>
						Effect.flatMap(fiberContext, (own) =>
							work.pipe(
								Effect.provideContext(current === null ? own : Context.merge(caller, own)),
								Effect.provideService(transactionExecutor, current),
								Effect.provideService(connectionExecutor, connection),
							),
						),
			);
			// Work the caller's rollback must not undo, or whose locks its transaction must not hold, takes its own
			// connection. The SQL client also finds a transaction in fiber context, so that entry has to go as well.
			const detached = <A, E>(work: Effect.Effect<A, E>) =>
				work.pipe(
					Effect.provideService(transactionExecutor, null),
					Effect.provideService(connectionExecutor, null),
					Effect.provideService(DatabaseConnectionLimit, undefined),
					Effect.updateContext((context: Context.Context<never>) =>
						Context.omit(sqlClient.transactionService)(context),
					),
				);
			return {
				run,
				carry,
				detached,
				savepoint,
				requireRoot,
				transaction,
				requireTransaction,
				isTransactionActive,
				acquireUserWriteLock,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make).pipe(Layer.provide(PgClientLive));
}

export const setLocalStatementTimeout = (timeoutMs: number) =>
	Effect.gen(function* () {
		const session = yield* DatabaseSession;
		yield* session.run((db) =>
			db.execute(sql`SELECT set_config('statement_timeout', ${timeoutMs.toString()}, true)`),
		);
	});
