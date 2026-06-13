import { drizzle } from "drizzle-orm/node-postgres";
import { Context, Effect, Exit, Layer, Redacted, Runtime } from "effect";
import { Pool } from "pg";

import { AppConfig } from "#lib/config";
import { DbError, unknownToDbError } from "#lib/errors";

import * as schemaTables from "./schema/tables";
import * as schemaAuth from "./schema/tables/auth";
import * as schemaRelations from "./schema/tables/relations";

const schema = { ...schemaAuth, ...schemaTables, ...schemaRelations };
const makeDb = (pool: Pool) => drizzle(pool, { schema, casing: "snake_case" });

export type DbRoot = ReturnType<typeof makeDb>;

export type DbTransaction = Parameters<Parameters<DbRoot["transaction"]>[0]>[0];
export type DbExecutor = DbRoot | DbTransaction;

/** @effect-leakable-service */
export class CurrentDb extends Context.Tag("CurrentDb")<CurrentDb, DbExecutor>() {}

export class DbService extends Effect.Service<DbService>()("DbService", {
	scoped: Effect.gen(function* () {
		const config = yield* AppConfig;
		const pool = new Pool({
			max: config.database.poolMax,
			statement_timeout: config.database.statementTimeoutMs,
			connectionString: Redacted.value(config.database.url),
			connectionTimeoutMillis: config.database.connectionTimeoutMs,
			idle_in_transaction_session_timeout: config.database.idleInTransactionTimeoutMs,
		});
		yield* Effect.addFinalizer(() => Effect.promise(() => pool.end()).pipe(Effect.orDie));
		return { pool, db: makeDb(pool) };
	}),
}) {}

export const dbEffect = <A>(try_: () => Promise<A>): Effect.Effect<A, DbError> =>
	Effect.tryPromise({ try: try_, catch: unknownToDbError });

export const isUniqueConstraintError = (constraint: string) => (error: unknown) =>
	error instanceof DbError && error.code === "23505" && error.constraint === constraint;

class RollbackTransaction<A, E> extends Error {
	constructor(readonly exit: Exit.Exit<A, E>) {
		super("Rollback transaction");
	}
}

const isRollbackTransaction = <A, E>(cause: unknown): cause is RollbackTransaction<A, E> =>
	cause instanceof RollbackTransaction;

const withTransaction = Effect.fn("withTransaction")(function* <A, E, R>(
	effect: Effect.Effect<A, E, R>,
) {
	const { db } = yield* DbService;
	const runtime = yield* Effect.runtime<Exclude<R, CurrentDb>>();
	// The effect runs on a detached fiber (Runtime.runPromiseExit) to bridge into Drizzle's
	// callback-based transaction. pg cannot cancel an in-flight statement, so the await runs
	// uninterruptibly: an interrupt is deferred until the transaction commits or rolls back,
	// instead of letting the caller proceed while the transaction is still writing. The
	// DATABASE_* timeouts bound this window so a stuck statement cannot pin the fiber. Keep
	// transactions short and free of long I/O; see "Transaction Design".
	const runTransaction = Effect.tryPromise({
		try: () =>
			db.transaction((tx) =>
				Runtime.runPromiseExit(runtime)(effect.pipe(Effect.provideService(CurrentDb, tx))).then(
					(innerExit) => {
						if (Exit.isFailure(innerExit)) {
							throw new RollbackTransaction(innerExit);
						}
						return innerExit;
					},
				),
			),
		catch: (cause) => (isRollbackTransaction<A, E>(cause) ? cause : unknownToDbError(cause)),
	}).pipe(
		Effect.catchAll((cause) =>
			isRollbackTransaction<A, E>(cause) ? Effect.succeed(cause.exit) : Effect.fail(cause),
		),
	);

	const exit = yield* Effect.uninterruptible(runTransaction);

	if (Exit.isSuccess(exit)) {
		return exit.value;
	}

	return yield* Effect.failCause(exit.cause);
});

export class DbRunner extends Context.Tag("DbRunner")<
	DbRunner,
	<A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, Exclude<R, CurrentDb>>
>() {}

export const DbRunnerLive = Layer.effect(
	DbRunner,
	Effect.gen(function* () {
		const { db } = yield* DbService;
		return <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, Exclude<R, CurrentDb>> =>
			Effect.provideService(effect, CurrentDb, db);
	}),
);

export class TransactionRunner extends Context.Tag("TransactionRunner")<
	TransactionRunner,
	<A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E | DbError, Exclude<R, CurrentDb>>
>() {}

export const TransactionRunnerLive = Layer.effect(
	TransactionRunner,
	Effect.gen(function* () {
		const dbService = yield* DbService;
		return <A, E, R>(
			effect: Effect.Effect<A, E, R>,
		): Effect.Effect<A, E | DbError, Exclude<R, CurrentDb>> =>
			withTransaction(effect).pipe(Effect.provideService(DbService, dbService));
	}),
);
