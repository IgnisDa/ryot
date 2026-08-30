import { DbError } from "@ryot-app/contract/errors";
import { isNotNull, sql } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";

import { createPluginConfigEncryption } from "#lib/infrastructure/config/plugin-config-encryption";
import {
	pluginConfigEncryptionKey,
	pluginConfigRevision,
} from "#lib/infrastructure/db/schema/tables/core";
import { DatabaseSession } from "#lib/infrastructure/db/session";

export class PluginConfigEncryptionKeyRepository extends Context.Service<PluginConfigEncryptionKeyRepository>()(
	"PluginConfigEncryptionKeyRepository",
	{
		make: Effect.gen(function* () {
			const database = yield* DatabaseSession;
			return {
				lock: database.run((db) =>
					db
						.execute(sql`lock table ${pluginConfigEncryptionKey} in exclusive mode`)
						.pipe(Effect.asVoid),
				),
				load: database.run((db) =>
					db
						.select()
						.from(pluginConfigEncryptionKey)
						.limit(1)
						.pipe(Effect.map(([key]) => key)),
				),
				insert: (key: Pick<typeof pluginConfigEncryptionKey.$inferInsert, "id" | "key">) =>
					database.run((db) =>
						db.insert(pluginConfigEncryptionKey).values(key).pipe(Effect.as(key)),
					),
				retainedKeyIds: database.run((db) =>
					db
						.selectDistinct({ id: pluginConfigRevision.encryptionKeyId })
						.from(pluginConfigRevision)
						.where(isNotNull(pluginConfigRevision.encryptedPayload)),
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
								return yield* new DbError({
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
							new DbError({ message: "Invalid persisted plugin configuration encryption key" }),
					});
					if ((yield* repository.retainedKeyIds).some(({ id }) => !encryption.hasKey(id))) {
						return yield* new DbError({
							message: "Retained plugin configuration references an unavailable encryption key",
						});
					}
					return encryption;
				});
				return yield* (yield* database.isTransactionActive) ? work : database.transaction(work);
			}).pipe(
				Effect.mapError((error) =>
					error instanceof DbError
						? error
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
