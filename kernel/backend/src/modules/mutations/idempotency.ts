import { DbError } from "@ryot-app/contract/errors";
import type { LifecycleCommand } from "@ryot-app/contract/modules/automations/lifecycle";
import type { UserId } from "@ryot-app/contract/schema/brands";
import { decodeStoredSchema } from "@ryot-app/contract/schema/core";
import { JsonValue } from "@ryot-app/contract/schema/json";
import { sha256Base64Url } from "@ryot-app/ts-utils/crypto";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { and, eq, inArray, sql } from "drizzle-orm";
import { Context, Duration, Effect, Layer, Schema } from "effect";

import { DatabaseSession } from "#platform/db/session";
import { importItem, importRun } from "#schema/tables/imports";
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
const ImportItemResult = Schema.Literals(["created", "updated", "unchanged"]);
export type ImportItemResult = typeof ImportItemResult.Type;

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
			const recordImportItem = Effect.fn("IdempotencyKeys.recordImportItem")(function* (
				command: LifecycleCommand,
				userId: null | UserId,
				result: ImportItemResult,
			) {
				const runId = command.causation.importRunId;
				if (runId === undefined || userId === null) {
					return yield* Effect.void;
				}
				yield* session.run((db) =>
					db
						.insert(importItem)
						.values({
							runId,
							data: result,
							kind: "result",
							id: command.itemIdentity,
						})
						.onConflictDoNothing(),
				);
				return yield* Effect.void;
			});
			const importItems = Effect.fn("IdempotencyKeys.importItems")(function* (input: {
				runId: string;
				userId: UserId;
				itemIdentities: ReadonlyArray<string>;
			}) {
				if (input.itemIdentities.length === 0) {
					return [];
				}
				const rows = yield* session.run((db) =>
					db
						.select({ id: importItem.id, data: importItem.data })
						.from(importItem)
						.where(
							and(
								eq(importItem.kind, "result"),
								eq(importItem.runId, input.runId),
								inArray(importItem.id, [...input.itemIdentities]),
								sql`exists (select 1 from ${importRun} where ${importRun.id} = ${input.runId} and ${importRun.userId} = ${input.userId})`,
							),
						),
				);
				return yield* Effect.forEach(rows, (row) =>
					Schema.decodeUnknownEffect(ImportItemResult)(row.data).pipe(
						Effect.mapBoth({
							onFailure: () => new DbError({ message: `Invalid import item ${row.id}` }),
							onSuccess: (result) => ({ result, itemIdentity: row.id }),
						}),
					),
				);
			});
			return { once, read, record, lockedRead, importItems, pruneExpired, recordImportItem };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
