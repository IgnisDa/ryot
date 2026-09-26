import { DbError } from "@ryot-app/contract/errors";
import { isNotNull, sql } from "drizzle-orm";
import { Context, Data, Effect, Layer } from "effect";

import { createPluginConfigEncryption } from "#lib/infrastructure/config/plugin-config-encryption";
import {
	pluginConfigEncryptionKey,
	pluginConfigRevision,
} from "#lib/infrastructure/db/schema/tables/core";
import { importRun } from "#lib/infrastructure/db/schema/tables/imports";
import { oauthConnection } from "#lib/infrastructure/db/schema/tables/oauth-connections";
import { DatabaseSession } from "#lib/infrastructure/db/session";

class PluginConfigEncryptionKeyStateError extends Data.TaggedError(
	"PluginConfigEncryptionKeyStateError",
)<{ readonly message: string }> {}

export class PluginConfigEncryptionKeyRepository extends Context.Service<PluginConfigEncryptionKeyRepository>()(
	"PluginConfigEncryptionKeyRepository",
	{
		make: Effect.gen(function* () {
			const database = yield* DatabaseSession;
			return {
				lock: Effect.suspend(() =>
					database.run((db) =>
						db
							.execute(sql`lock table ${pluginConfigEncryptionKey} in exclusive mode`)
							.pipe(Effect.asVoid),
					),
				),
				load: Effect.suspend(() =>
					database.run((db) =>
						db
							.select()
							.from(pluginConfigEncryptionKey)
							.limit(1)
							.pipe(Effect.map(([key]) => key)),
					),
				),
				insert: (key: Pick<typeof pluginConfigEncryptionKey.$inferInsert, "id" | "key">) =>
					database.run((db) =>
						db.insert(pluginConfigEncryptionKey).values(key).pipe(Effect.as(key)),
					),
				retainedKeyIds: Effect.suspend(() =>
					Effect.all([
						database.run((db) =>
							db
								.selectDistinct({ id: pluginConfigRevision.encryptionKeyId })
								.from(pluginConfigRevision)
								.where(isNotNull(pluginConfigRevision.encryptedPayload)),
						),
						database.run((db) =>
							db
								.selectDistinct({
									code: sql<string | null>`${oauthConnection.code} ->> 'keyId'`,
									accessToken: sql<string | null>`${oauthConnection.accessToken} ->> 'keyId'`,
									codeVerifier: sql<string | null>`${oauthConnection.codeVerifier} ->> 'keyId'`,
									refreshToken: sql<string | null>`${oauthConnection.refreshToken} ->> 'keyId'`,
								})
								.from(oauthConnection),
						),
						database.run((db) =>
							db
								.selectDistinct({
									id: sql<string | null>`${importRun.preparedRelease} -> 'state' ->> 'keyId'`,
								})
								.from(importRun)
								.where(isNotNull(importRun.preparedRelease)),
						),
					]).pipe(
						Effect.map(([configKeys, oauthKeys, preparedReleaseKeys]) => [
							...configKeys,
							...oauthKeys.flatMap((row) =>
								Object.values(row).flatMap((id) => (id === null ? [] : [{ id }])),
							),
							...preparedReleaseKeys.flatMap(({ id }) => (id === null ? [] : [{ id }])),
						]),
					),
				),
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}

export class PluginConfigEncryptionKey extends Context.Service<PluginConfigEncryptionKey>()(
	"PluginConfigEncryptionKey",
	{
		make: Effect.gen(function* () {
			const repository = yield* PluginConfigEncryptionKeyRepository;
			const database = yield* DatabaseSession;
			const load = Effect.gen(function* () {
				const work = Effect.gen(function* () {
					let key = yield* repository.load;
					if (!key) {
						yield* repository.lock;
						key = yield* repository.load;
						if (!key) {
							if ((yield* repository.retainedKeyIds).length > 0) {
								return yield* new PluginConfigEncryptionKeyStateError({
									message:
										"Persisted plugin configuration encryption key is missing; restore the key for retained payloads",
								});
							}
							const generated = yield* repository.insert({
								id: crypto.randomUUID(),
								key: Buffer.from(crypto.getRandomValues(new Uint8Array(32))),
							});
							return createPluginConfigEncryption(generated);
						}
					}
					const encryption = yield* Effect.try({
						try: () => createPluginConfigEncryption(key),
						catch: () =>
							new PluginConfigEncryptionKeyStateError({
								message: "Invalid persisted plugin configuration encryption key",
							}),
					});
					if ((yield* repository.retainedKeyIds).some(({ id }) => !encryption.hasKey(id))) {
						return yield* new PluginConfigEncryptionKeyStateError({
							message: "Retained plugin configuration references an unavailable encryption key",
						});
					}
					return encryption;
				});
				return yield* (yield* database.isTransactionActive) ? work : database.transaction(work);
			}).pipe(
				Effect.mapError((error) =>
					error instanceof PluginConfigEncryptionKeyStateError
						? new DbError({ message: error.message })
						: new DbError({ message: "Cannot load persisted plugin configuration encryption key" }),
				),
			);
			return { load };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make).pipe(
		Layer.provide(PluginConfigEncryptionKeyRepository.layer),
	);
}
