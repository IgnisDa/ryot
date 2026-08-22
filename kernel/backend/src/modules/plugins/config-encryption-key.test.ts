import { expect, it } from "@effect/vitest";
import { UserId } from "@ryot-app/contract/schema/brands";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { sql } from "drizzle-orm";
import { Data, Deferred, Effect, Layer, Redacted } from "effect";
import { assert, describe } from "vitest";

import * as tables from "#lib/infrastructure/db/schema/tables/core";
import { Database, DatabaseLive } from "#lib/infrastructure/db/service";
import { testDatabaseUrl } from "#lib/test-utils/database";
import { makeAppConfigLayer } from "#lib/test-utils/effect";
import { ARCHIVE_CODECS } from "#modules/backups/archive/schemas";

import { PluginConfigEncryptionKey } from "./config-encryption-key";
import { PluginConfigRevisions } from "./config-revisions";
import { PluginInstallationRepository } from "./installation-repository";
import { PluginRepository } from "./repository";
import {
	installRevisionPackage,
	revisionPackage,
	withRevisionDatabase,
} from "./revision.test-support";

class RollbackKeyTest extends Data.TaggedError("RollbackKeyTest") {}

describe("persisted plugin configuration encryption key", () => {
	it.effect("retries after missing schema and never caches a rolled-back key", () =>
		withRevisionDatabase(
			Effect.gen(function* () {
				const db = yield* Database;
				const service = yield* PluginConfigEncryptionKey;
				yield* db
					.transaction((tx) =>
						Effect.gen(function* () {
							yield* tx.execute(sql`set local search_path to pg_catalog`);
							expect((yield* Effect.flip(service.load)).message).toBe(
								"Cannot load persisted plugin configuration encryption key",
							);
							return yield* new RollbackKeyTest();
						}).pipe(Effect.provideService(Database, tx)),
					)
					.pipe(Effect.catchTag("RollbackKeyTest", () => Effect.void));
				let rolledBackId = "";
				yield* db
					.transaction((tx) =>
						Effect.gen(function* () {
							rolledBackId = (yield* service.load).activeKeyId;
							return yield* new RollbackKeyTest();
						}).pipe(Effect.provideService(Database, tx)),
					)
					.pipe(Effect.catchTag("RollbackKeyTest", () => Effect.void));
				expect(yield* db.select().from(tables.pluginConfigEncryptionKey)).toEqual([]);
				expect((yield* service.load).activeKeyId).not.toBe(rolledBackId);
				expect(yield* db.select().from(tables.pluginConfigEncryptionKey)).toHaveLength(1);
			}),
		),
	);
	it.effect("excludes the shared key from account backup plugin inputs and archive sections", () =>
		withRevisionDatabase(
			Effect.gen(function* () {
				const db = yield* Database;
				const configs = yield* PluginConfigRevisions;
				const plugins = yield* PluginRepository;
				const installations = yield* PluginInstallationRepository;
				yield* configs.validateKeys();
				yield* installRevisionPackage(revisionPackage("system"));
				yield* installRevisionPackage(revisionPackage("private"), UserId.make("owner"));
				const [key] = yield* db.select().from(tables.pluginConfigEncryptionKey);
				assert(key);
				const system = yield* plugins.listPortablePluginMetadata();
				const privatePlugins = yield* plugins.listPrivateForUser(UserId.make("owner"));
				const installed = yield* installations.listForUser(UserId.make("owner"));
				expect(system).toHaveLength(1);
				expect(privatePlugins).toHaveLength(1);
				expect(installed).toHaveLength(2);
				const exported = stableStringify({ system, installed, privatePlugins });
				for (const secret of [
					key.id,
					key.key.toString("hex"),
					key.key.toString("base64"),
					stableStringify(key.key),
				]) {
					expect(exported).not.toContain(secret);
				}
				expect(Object.keys(ARCHIVE_CODECS).join("\n")).not.toMatch(
					/encryption|keyring|config[_-]revisions/i,
				);
			}),
		),
	);
	it.effect(
		"initializes lazily and decrypts retained configs across independent services and admin token changes",
		() =>
			withRevisionDatabase(
				Effect.gen(function* () {
					const db = yield* Database;
					const configs = yield* PluginConfigRevisions;
					expect(yield* db.select().from(tables.pluginConfigEncryptionKey)).toEqual([]);
					yield* configs.validateKeys();
					const [key] = yield* db.select().from(tables.pluginConfigEncryptionKey);
					assert(key);
					expect(key.key.length).toBe(32);
					expect(key.createdAt).toBeInstanceOf(Date);
					const installed = yield* installRevisionPackage(revisionPackage(), UserId.make("owner"));
					const id = yield* configs.create({
						ownerUserId: "owner",
						scope: "installation",
						pluginRevisionId: installed.revisionId,
						properties: { token: "retained-private-token" },
						pluginInstallationId: installed.installation.id,
					});
					const restarted = yield* PluginConfigRevisions.make.pipe(
						Effect.provide(
							Layer.merge(
								PluginConfigEncryptionKey.layer,
								makeAppConfigLayer({
									server: { adminAccessToken: Redacted.make("changed-admin-token") },
								}),
							),
						),
					);
					expect(
						yield* restarted.read({
							id,
							ownerUserId: "owner",
							pluginRevisionId: installed.revisionId,
						}),
					).toEqual({ token: "retained-private-token" });
					yield* restarted.validateKeys();
					expect(yield* db.select().from(tables.pluginConfigEncryptionKey)).toEqual([key]);
				}),
			),
	);

	it.effect(
		"does not replace missing keys and sanitizes malformed keys and mismatched retained references",
		() =>
			withRevisionDatabase(
				Effect.gen(function* () {
					const db = yield* Database;
					const configs = yield* PluginConfigRevisions;
					const installed = yield* installRevisionPackage(revisionPackage(), UserId.make("owner"));
					yield* configs.create({
						ownerUserId: "owner",
						scope: "installation",
						pluginRevisionId: installed.revisionId,
						properties: { token: "never-expose-token" },
						pluginInstallationId: installed.installation.id,
					});
					const [key] = yield* db.select().from(tables.pluginConfigEncryptionKey);
					assert(key);
					yield* db.delete(tables.pluginConfigEncryptionKey);
					const missing = yield* Effect.flip(configs.validateKeys());
					expect(missing.message).toContain("key is missing");
					expect(yield* db.select().from(tables.pluginConfigEncryptionKey)).toEqual([]);
					yield* db
						.insert(tables.pluginConfigEncryptionKey)
						.values({ ...key, id: "private-mismatched-id" });
					expect((yield* Effect.flip(configs.validateKeys())).message).toBe(
						"Retained plugin configuration references an unavailable encryption key",
					);
					yield* db.update(tables.pluginConfigEncryptionKey).set({ id: "private-malformed-id!" });
					expect((yield* Effect.flip(configs.validateKeys())).message).toBe(
						"Invalid persisted plugin configuration encryption key",
					);
					yield* db.execute(
						sql`alter table ${tables.pluginConfigEncryptionKey} drop constraint plugin_config_encryption_key_length_check`,
					);
					yield* db
						.update(tables.pluginConfigEncryptionKey)
						.set({ id: key.id, key: Buffer.from("private-short-key") });
					expect((yield* Effect.flip(configs.validateKeys())).message).toBe(
						"Invalid persisted plugin configuration encryption key",
					);
				}),
			),
	);

	it.effect("uses one first-start winner across real concurrent PostgreSQL connections", () => {
		const name = `key_concurrency_${crypto.randomUUID().replaceAll("-", "")}`;
		return Effect.gen(function* () {
			const db = yield* Database;
			const directory = new URL("../../drizzle/", import.meta.url).pathname;
			const paths = [...new Bun.Glob("*/migration.sql").scanSync({ cwd: directory })];
			assert(paths.length === 1);
			const ddl = yield* Effect.promise(() => Bun.file(directory + paths[0]).text());
			yield* Effect.acquireUseRelease(
				db.transaction((tx) =>
					Effect.gen(function* () {
						yield* tx.execute(sql`create schema ${sql.identifier(name)}`);
						yield* tx.execute(sql`set local search_path to ${sql.identifier(name)}, public`);
						for (const statement of ddl.split("--> statement-breakpoint")) {
							yield* tx.execute(sql.raw(statement));
						}
					}),
				),
				() =>
					Effect.gen(function* () {
						const ready = yield* Deferred.make<void>();
						let arrivals = 0;
						const results = yield* Effect.all(
							Array.from({ length: 4 }, () =>
								db.transaction((tx) =>
									Effect.gen(function* () {
										yield* tx.execute(
											sql`set local search_path to ${sql.identifier(name)}, public`,
										);
										const [connection] = yield* tx
											.select({ pid: sql<number>`pid` })
											.from(sql`(select pg_backend_pid() as pid) as connection`);
										assert(connection);
										expect(yield* tx.select().from(tables.pluginConfigEncryptionKey)).toEqual([]);
										arrivals += 1;
										if (arrivals === 4) {
											yield* Deferred.succeed(ready, undefined);
										}
										yield* Deferred.await(ready);
										const encryption = yield* PluginConfigEncryptionKey;
										const loaded = yield* encryption.load;
										return {
											pid: connection.pid,
											envelope: yield* loaded.encrypt({ token: "shared" }, { owner: "test" }),
										};
									}).pipe(
										Effect.provideService(Database, tx),
										Effect.provide(PluginConfigEncryptionKey.layer),
									),
								),
							),
							{ concurrency: "unbounded" },
						);
						expect(new Set(results.map((result) => result.pid)).size).toBe(4);
						expect(new Set(results.map((result) => result.envelope.encryptionKeyId)).size).toBe(1);
						yield* db.transaction((tx) =>
							Effect.gen(function* () {
								yield* tx.execute(sql`set local search_path to ${sql.identifier(name)}, public`);
								const encryption = yield* PluginConfigEncryptionKey;
								const loaded = yield* encryption.load;
								for (const result of results) {
									expect(yield* loaded.decrypt(result.envelope, { owner: "test" })).toEqual({
										token: "shared",
									});
								}
								expect(yield* tx.select().from(tables.pluginConfigEncryptionKey)).toHaveLength(1);
							}).pipe(
								Effect.provideService(Database, tx),
								Effect.provide(PluginConfigEncryptionKey.layer),
							),
						);
					}),
				() => db.execute(sql`drop schema ${sql.identifier(name)} cascade`).pipe(Effect.orDie),
			);
		}).pipe(
			Effect.provide(
				DatabaseLive.pipe(
					Layer.provide(
						makeAppConfigLayer({ database: { url: Redacted.make(testDatabaseUrl()) } }),
					),
				),
			),
		);
	});
});
