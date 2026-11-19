import type { DbError } from "@ryot-app/contract/errors";
import type { CommittedChanges } from "@ryot-app/contract/modules/changes/change-set";
import type { EventCreateItemOutcome } from "@ryot-app/contract/modules/events/schemas";
import { Effect, type Schema } from "effect";

import type { IdempotencyIdentity, IdempotencyKeys } from "#modules/mutations/idempotency";

/** What a commit wrote; `outcomes` lists every event create by position in independent-items mode. */
export type CommitResult = {
	readonly committed: CommittedChanges;
	readonly outcomes: ReadonlyArray<EventCreateItemOutcome>;
};

/**
 * Durable state that records a commit's result in its transaction. `load` runs first and returns the
 * result a previous commit recorded, which ends the commit without writing; `record` runs after every
 * write.
 */
export type CommitReceipt<A> = {
	readonly load: Effect.Effect<A | null, DbError>;
	readonly record: (result: CommitResult) => Effect.Effect<A, DbError>;
};

/** A receipt held by the account's idempotency key. */
export const keyedReceipt = <A>(
	keys: IdempotencyKeys["Service"],
	identity: IdempotencyIdentity,
	response: Schema.Codec<A, unknown>,
	toResponse: (result: CommitResult) => A,
): CommitReceipt<A> => ({
	record: (result) => {
		const value = toResponse(result);
		return keys.record(identity, response, value).pipe(Effect.as(value));
	},
	load: keys.lockedRead(identity, response).pipe(
		Effect.catchTag("IdempotencyConflict", () =>
			Effect.die("A keyed commit received different changes on replay"),
		),
		Effect.map((stored) => stored?.response ?? null),
	),
});

/** No durable state: the commit's written changes. */
export const unrecordedChanges: CommitReceipt<CommittedChanges> = {
	load: Effect.succeed(null),
	record: (result) => Effect.succeed(result.committed),
};
