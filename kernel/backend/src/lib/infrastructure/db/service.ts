import { PgClient } from "@effect/sql-pg";
import { DbError, unknownToDbError } from "@ryot-app/contract/errors";
import { sql } from "drizzle-orm";
import { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import * as PgDrizzle from "drizzle-orm/effect-postgres";
import { Cause, Context, Duration, Effect, Layer } from "effect";
import { SqlError } from "effect/unstable/sql/SqlError";

import { AppConfig } from "#lib/infrastructure/config/service";

export const PgClientLive = Layer.unwrap(
	Effect.map(AppConfig, (config) =>
		PgClient.layer({
			url: config.database.url,
			maxConnections: config.database.poolMax,
			connectTimeout: Duration.millis(config.database.connectionTimeoutMs),
		}),
	),
);

/** @effect-leakable-service */
export class Database extends Context.Service<Database, PgDrizzle.EffectPgDatabase>()("Database") {
	static readonly layer = Layer.effect(this, PgDrizzle.makeWithDefaults());
}

export const DatabaseLive = Database.layer.pipe(Layer.provideMerge(PgClientLive));

const unwrapDatabaseFailure = (failure: unknown): unknown => {
	if (Cause.isCause(failure)) {
		return unwrapDatabaseFailure(Cause.squash(failure));
	}
	if (failure instanceof EffectDrizzleQueryError) {
		return unwrapDatabaseFailure(failure.cause);
	}
	if (failure instanceof SqlError) {
		return unwrapDatabaseFailure(failure.reason.cause);
	}
	return failure;
};

export const databaseError = (failure: unknown) => unknownToDbError(unwrapDatabaseFailure(failure));

type NativeDatabaseError = EffectDrizzleQueryError | SqlError;

type MappedDatabaseError<E> = E extends NativeDatabaseError ? DbError : E;

export function mapDatabaseErrors<A, E, R>(
	effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, MappedDatabaseError<E>, R>;
export function mapDatabaseErrors<A, E, R>(effect: Effect.Effect<A, E, R>) {
	return effect.pipe(
		Effect.mapError((error) =>
			error instanceof EffectDrizzleQueryError || error instanceof SqlError
				? databaseError(error)
				: error,
		),
	);
}

export const retryOnDeadlock = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
	effect.pipe(
		Effect.retry({
			times: 2,
			while: (error) => error instanceof DbError && error.code === "40P01",
		}),
	);

export const setLocalStatementTimeout = (timeoutMs: number) =>
	Effect.gen(function* () {
		const database = yield* Database;
		yield* mapDatabaseErrors(
			database.execute(sql`SELECT set_config('statement_timeout', ${timeoutMs.toString()}, true)`),
		);
	});

export const isUniqueConstraintError = (constraint: string) => (error: unknown) =>
	error instanceof DbError && error.code === "23505" && error.constraint === constraint;
