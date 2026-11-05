import { DbError } from "@ryot-app/contract/errors";
import type { UserId } from "@ryot-app/contract/schema/brands";
import { decodeStoredSchema } from "@ryot-app/contract/schema/core";
import { JsonValue } from "@ryot-app/contract/schema/json";
import { sha256Base64Url } from "@ryot-app/ts-utils/crypto";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { and, eq, sql } from "drizzle-orm";
import { Context, Duration, Effect, Layer, Schema } from "effect";

import { DatabaseSession } from "#platform/db/session";
import { idempotencyKey } from "#schema/tables/mutations";

import { IDEMPOTENCY_KEY_RETENTION } from "./submission-window";

export type IdempotencyIdentity = {
	readonly key: string;
	readonly userId: UserId;
	readonly fingerprint: string;
};

export const idempotencyIdentity = (input: {
	readonly key: string;
	readonly kind: string;
	readonly userId: UserId;
	readonly request: unknown;
}): IdempotencyIdentity => ({
	userId: input.userId,
	key: `${input.kind}:${input.key}`,
	fingerprint: sha256Base64Url(stableStringify(input.request)),
});

export class IdempotencyConflict extends Schema.TaggedError<
	IdempotencyConflict,
	{ readonly brand: unique symbol }
>()("IdempotencyConflict", { key: Schema.String }) {}

const encode = <Response>(
	value: Response,
	response: Schema.Codec<Response, unknown>,
	identity: IdempotencyIdentity,
) =>
	Schema.encodeEffect(response)(value).pipe(
		Effect.flatMap((encoded) =>
			decodeStoredSchema(encoded, JsonValue, `Invalid response for ${identity.key}`),
		),
		Effect.mapError(() => new DbError({ message: `Invalid response for ${identity.key}` })),
	);
export class IdempotencyKeys extends Context.Service<IdempotencyKeys>()(
	"@ryot-app/kernel-backend/modules/mutations/idempotency/IdempotencyKeys",
	{
		make: Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const read = Effect.fnUntraced(function* <Response>(
				identity: IdempotencyIdentity,
				response: Schema.Codec<Response, unknown>,
			) {
				const [row] = yield* session.run((db) =>
					db
						.select()
						.from(idempotencyKey)
						.where(
							and(eq(idempotencyKey.userId, identity.userId), eq(idempotencyKey.key, identity.key)),
						),
				);
				if (!row) {
					return null;
				}
				if (row.fingerprint !== identity.fingerprint) {
					return yield* new IdempotencyConflict({ key: identity.key });
				}
				return {
					response: yield* decodeStoredSchema(
						row.response,
						response,
						`Invalid stored response for ${identity.key}`,
					),
				};
			});
			/** Reads a key on the caller's transaction, which a concurrent retry of the same key then waits on. */
			const lockedRead = Effect.fnUntraced(function* <Response>(
				identity: IdempotencyIdentity,
				response: Schema.Codec<Response, unknown>,
			) {
				yield* session.requireTransaction.pipe(
					Effect.mapError(() => new DbError({ message: "Idempotency key requires a transaction" })),
				);
				yield* session.run((db) =>
					db.execute(
						sql`select pg_advisory_xact_lock(hashtext(${`idempotency-key:${identity.userId}:${identity.key}`}))`,
					),
				);
				return yield* read(identity, response);
			});
			const record = Effect.fnUntraced(function* <Response>(
				identity: IdempotencyIdentity,
				response: Schema.Codec<Response, unknown>,
				value: Response,
			) {
				const encoded = yield* encode(value, response, identity);
				yield* session.run((db) =>
					db
						.insert(idempotencyKey)
						.values({ ...identity, response: encoded })
						.onConflictDoNothing(),
				);
			});
			/** Runs `write` once per key on the caller's transaction, so the write and its key commit together. */
			const once = Effect.fnUntraced(function* <Response, E, R>(
				identity: IdempotencyIdentity,
				response: Schema.Codec<Response, unknown>,
				write: Effect.Effect<Response, E, R>,
			) {
				const stored = yield* lockedRead(identity, response);
				if (stored) {
					return stored.response;
				}
				const value = yield* write;
				yield* record(identity, response, value);
				return value;
			});
			const pruneExpired = Effect.fn("IdempotencyKeys.pruneExpired")(function* (limit: number) {
				const rows = yield* session.run((db) =>
					db.execute<{ key: string }>(
						sql`delete from ${idempotencyKey} where (user_id, key) in (
							select user_id, key from ${idempotencyKey}
							where created_at < now() - make_interval(secs => ${Duration.toSeconds(IDEMPOTENCY_KEY_RETENTION)})
							order by created_at
							limit ${limit}
							for update skip locked
						) returning key`,
						"objects",
					),
				);
				return rows.length;
			});
			return { once, read, record, lockedRead, pruneExpired };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
