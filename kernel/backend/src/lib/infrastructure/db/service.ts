import { PgClient } from "@effect/sql-pg";
import { DbError, unknownToDbError } from "@ryot-app/contract/errors";
import { sql } from "drizzle-orm";
import { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import * as PgDrizzle from "drizzle-orm/effect-postgres";
import { Context, Duration, Effect, Layer } from "effect";
import { SqlError } from "effect/unstable/sql/SqlError";
import { types as pgTypes } from "pg";

import { AppConfig } from "#lib/infrastructure/config/service";

const drizzleParsedTypeIds = new Set([1184, 1114, 1082, 1186, 1231, 1115, 1185, 1187, 1182]);

export const PgClientLive = Layer.unwrap(
	Effect.map(AppConfig, (config) =>
		PgClient.layer({
			url: config.database.url,
			maxConnections: config.database.poolMax,
			connectTimeout: Duration.millis(config.database.connectionTimeoutMs),
			types: {
				getTypeParser: (typeId, format) =>
					drizzleParsedTypeIds.has(typeId)
						? (value: string) => value
						: pgTypes.getTypeParser(typeId, format),
			},
		}),
	),
);

/** @effect-leakable-service */
export class Database extends Context.Service<Database, PgDrizzle.EffectPgDatabase>()("Database") {
	static readonly layer = Layer.effect(this, PgDrizzle.makeWithDefaults());
}

export const DatabaseLive = Database.layer.pipe(Layer.provideMerge(PgClientLive));

const unwrapDatabaseFailure = (failure: unknown): unknown => {
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

export const setLocalStatementTimeout = (timeoutMs: number) =>
	Effect.gen(function* () {
		const database = yield* Database;
		yield* mapDatabaseErrors(
			database.execute(sql`SELECT set_config('statement_timeout', ${timeoutMs.toString()}, true)`),
		);
	});

export const isUniqueConstraintError = (constraint: string) => (error: unknown) =>
	error instanceof DbError && error.code === "23505" && error.constraint === constraint;
