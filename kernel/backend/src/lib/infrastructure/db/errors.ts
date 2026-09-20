import { DbError, unknownToDbError } from "@ryot-app/contract/errors";
import { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Cause, Effect } from "effect";
import { SqlError } from "effect/unstable/sql/SqlError";

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

export const isUniqueConstraintError = (constraint: string) => (error: unknown) =>
	error instanceof DbError && error.code === "23505" && error.constraint === constraint;
