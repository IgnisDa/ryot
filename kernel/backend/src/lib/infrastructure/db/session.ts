import { sql } from "drizzle-orm";
import * as PgDrizzle from "drizzle-orm/effect-postgres";
import { Context, Data, Effect, Layer } from "effect";

import { mapDatabaseErrors, PgClientLive } from "./service";

export class DatabaseSessionStateError extends Data.TaggedError("DatabaseSessionStateError")<{
	readonly reason: "transaction-already-active" | "transaction-required";
}> {}

export class DatabaseSession extends Context.Service<DatabaseSession>()("DatabaseSession", {
	make: Effect.gen(function* () {
		const root = yield* PgDrizzle.makeWithDefaults();
		// Effect v4's Context.Reference is fiber-local and replaces FiberRef.
		const transactionExecutor = Context.Reference<PgDrizzle.EffectPgDatabase | null>(
			"DatabaseSession.TransactionExecutor",
			{ defaultValue: () => null },
		);
		const current = Effect.map(transactionExecutor, (executor) => executor ?? root);
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
		return { current, requireRoot, transaction, requireTransaction, isTransactionActive };
	}),
}) {
	static readonly layer = Layer.effect(this, this.make).pipe(
		Layer.provide(Layer.unwrap(Effect.sync(() => PgClientLive))),
	);
}

export const setLocalStatementTimeout = (timeoutMs: number) =>
	Effect.gen(function* () {
		const database = yield* (yield* DatabaseSession).current;
		yield* mapDatabaseErrors(
			database.execute(sql`SELECT set_config('statement_timeout', ${timeoutMs.toString()}, true)`),
		);
	});
