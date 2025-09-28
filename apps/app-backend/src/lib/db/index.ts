import { drizzle } from "drizzle-orm/node-postgres";
import { Context, Effect, Exit, Layer, Redacted, Runtime } from "effect";
import { Pool } from "pg";

import { AppConfig } from "../config";
import { DbError, unknownToDbError } from "../errors";
import * as schema from "./schema";

const makeDb = (pool: Pool) => drizzle(pool, { schema, casing: "snake_case" });

type DbRoot = ReturnType<typeof makeDb>;

export type DbTransaction = Parameters<Parameters<DbRoot["transaction"]>[0]>[0];
export type DbExecutor = DbRoot | DbTransaction;

/** @effect-leakable-service */
export class CurrentDb extends Context.Tag("CurrentDb")<CurrentDb, DbExecutor>() {}

export class DbService extends Context.Tag("DbService")<
	DbService,
	{ readonly pool: Pool; readonly db: DbRoot }
>() {}

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

const withTransaction = <A, E, R>(
	effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E | DbError, DbService | Exclude<R, CurrentDb>> =>
	Effect.gen(function* () {
		const { db } = yield* DbService;
		// The effect runs on a detached fiber (Runtime.runPromiseExit) to bridge into Drizzle's
		// callback-based transaction, so interrupting the caller will not cancel an in-flight
		// transaction. Keep transactions short and free of long I/O; see "Transaction Design".
		const runtime = yield* Effect.runtime<Exclude<R, CurrentDb>>();
		const exit = yield* Effect.tryPromise({
			// @effect-diagnostics-next-line asyncFunction:off
			try: () =>
				db.transaction(async (tx) => {
					const innerExit = await Runtime.runPromiseExit(runtime)(
						effect.pipe(Effect.provideService(CurrentDb, tx)),
					);
					if (Exit.isFailure(innerExit)) {
						throw new RollbackTransaction(innerExit);
					}
					return innerExit;
				}),
			catch: (cause) => (isRollbackTransaction<A, E>(cause) ? cause : unknownToDbError(cause)),
		}).pipe(
			Effect.catchAll((cause) =>
				isRollbackTransaction<A, E>(cause) ? Effect.succeed(cause.exit) : Effect.fail(cause),
			),
		);

		if (Exit.isSuccess(exit)) {
			return exit.value;
		}

		return yield* Effect.failCause(exit.cause);
	});

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

export const DbLive = Layer.scoped(
	DbService,
	Effect.gen(function* () {
		const config = yield* AppConfig;
		const pool = new Pool({ connectionString: Redacted.value(config.databaseUrl) });
		yield* Effect.addFinalizer(() => Effect.promise(() => pool.end()).pipe(Effect.orDie));
		return { pool, db: makeDb(pool) };
	}),
);

export { schema };
