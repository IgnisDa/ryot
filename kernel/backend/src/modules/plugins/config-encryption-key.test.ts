import { expect, layer } from "@effect/vitest";
import { UserId } from "@ryot-app/contract/schema/brands";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { sql } from "drizzle-orm";
import { Context, Data, Deferred, Effect, Layer, Redacted } from "effect";
import { assert, describe } from "vitest";

import * as tables from "#lib/infrastructure/db/schema/tables/core";
import { DatabaseSession } from "#lib/infrastructure/db/session";
import {
	applyBaselineMigration,
	baselineMigrationStatements,
} from "#lib/test-utils/baseline-migration";
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
	revisionDatabaseLayer,
} from "./revision.test-support";

class RollbackKeyTest extends Data.TaggedError("RollbackKeyTest") {}

class RestartedConfigRevisions extends Context.Service<
	RestartedConfigRevisions,
	PluginConfigRevisions["Service"]
>()("test/RestartedConfigRevisions") {}

const restartedConfigRevisionsLayer = Layer.effect(
	RestartedConfigRevisions,
	PluginConfigRevisions.make,
).pipe(
	Layer.provide(Layer.fresh(PluginConfigEncryptionKey.layer)),
	Layer.provide(
		makeAppConfigLayer({ server: { adminAccessToken: Redacted.make("changed-admin-token") } }),
	),
);

const sharedDatabaseEncryptionKeyLayer = PluginConfigEncryptionKey.layer.pipe(
	Layer.provideMerge(
		Layer.unwrap(
			Effect.sync(() =>
				DatabaseSession.layer.pipe(
					Layer.provide(
						makeAppConfigLayer({ database: { url: Redacted.make(testDatabaseUrl()) } }),
					),
				),
			),
		),
	),
);

describe("persisted plugin configuration encryption key", () => {
	layer(revisionDatabaseLayer)((test) => {
		test.effect("retries after missing schema and never caches a rolled-back key", () =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const service = yield* PluginConfigEncryptionKey;
				yield* session
					.transaction(
						session.run((tx) =>
							Effect.gen(function* () {
								yield* tx.execute(sql`set local search_path to pg_catalog`);
								expect((yield* Effect.flip(service.load)).message).toBe(
									"Cannot load persisted plugin configuration encryption key",
								);
								return yield* new RollbackKeyTest();
							}),
						),
					)
					.pipe(Effect.catchTag("RollbackKeyTest", () => Effect.void));
				let rolledBackId = "";
				yield* session
					.transaction(
						Effect.gen(function* () {
							rolledBackId = (yield* service.load).activeKeyId;
							return yield* new RollbackKeyTest();
						}),
					)
					.pipe(Effect.catchTag("RollbackKeyTest", () => Effect.void));
				expect(
					yield* session.run((db) => db.select().from(tables.pluginConfigEncryptionKey)),
				).toEqual([]);
				expect((yield* service.load).activeKeyId).not.toBe(rolledBackId);
				expect(
					yield* session.run((db) => db.select().from(tables.pluginConfigEncryptionKey)),
				).toHaveLength(1);
			}),
		);
	});
	layer(revisionDatabaseLayer)((test) => {
		test.effect(
			"excludes the shared key from account backup plugin inputs and archive sections",
			() =>
				Effect.gen(function* () {
					const session = yield* DatabaseSession;
					const configs = yield* PluginConfigRevisions;
					const plugins = yield* PluginRepository;
					const installations = yield* PluginInstallationRepository;
					yield* configs.validateKeys();
					yield* installRevisionPackage(revisionPackage("system"));
					yield* installRevisionPackage(revisionPackage("private"), UserId.make("owner"));
					const [key] = yield* session.run((db) =>
						db.select().from(tables.pluginConfigEncryptionKey),
					);
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
		);
	});
	layer(restartedConfigRevisionsLayer.pipe(Layer.provideMerge(revisionDatabaseLayer)))((test) => {
		test.effect(
			"initializes lazily and decrypts retained configs across independent services and admin token changes",
			() =>
				Effect.gen(function* () {
					const session = yield* DatabaseSession;
					const configs = yield* PluginConfigRevisions;
					expect(
						yield* session.run((db) => db.select().from(tables.pluginConfigEncryptionKey)),
					).toEqual([]);
					yield* configs.validateKeys();
					const [key] = yield* session.run((db) =>
						db.select().from(tables.pluginConfigEncryptionKey),
					);
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
					const restarted = yield* RestartedConfigRevisions;
					expect(
						yield* restarted.read({
							id,
							ownerUserId: "owner",
							pluginRevisionId: installed.revisionId,
						}),
					).toEqual({ token: "retained-private-token" });
					yield* restarted.validateKeys();
					expect(
						yield* session.run((db) => db.select().from(tables.pluginConfigEncryptionKey)),
					).toEqual([key]);
				}),
		);
	});

	layer(revisionDatabaseLayer)((test) => {
		test.effect(
			"does not replace missing keys and sanitizes malformed keys and mismatched retained references",
			() =>
				Effect.gen(function* () {
					const session = yield* DatabaseSession;
					const configs = yield* PluginConfigRevisions;
					const installed = yield* installRevisionPackage(revisionPackage(), UserId.make("owner"));
					yield* configs.create({
						ownerUserId: "owner",
						scope: "installation",
						pluginRevisionId: installed.revisionId,
						properties: { token: "never-expose-token" },
						pluginInstallationId: installed.installation.id,
					});
					const [key] = yield* session.run((db) =>
						db.select().from(tables.pluginConfigEncryptionKey),
					);
					assert(key);
					yield* session.run((db) => db.delete(tables.pluginConfigEncryptionKey));
					const missing = yield* Effect.flip(configs.validateKeys());
					expect(missing.message).toContain("key is missing");
					expect(
						yield* session.run((db) => db.select().from(tables.pluginConfigEncryptionKey)),
					).toEqual([]);
					yield* session.run((db) =>
						db
							.insert(tables.pluginConfigEncryptionKey)
							.values({ ...key, id: "private-mismatched-id" }),
					);
					expect((yield* Effect.flip(configs.validateKeys())).message).toBe(
						"Retained plugin configuration references an unavailable encryption key",
					);
					yield* session.run((db) =>
						db.update(tables.pluginConfigEncryptionKey).set({ id: "private-malformed-id!" }),
					);
					expect((yield* Effect.flip(configs.validateKeys())).message).toBe(
						"Invalid persisted plugin configuration encryption key",
					);
					yield* session.run((db) =>
						db.execute(
							sql`alter table ${tables.pluginConfigEncryptionKey} drop constraint plugin_config_encryption_key_length_check`,
						),
					);
					yield* session.run((db) =>
						db
							.update(tables.pluginConfigEncryptionKey)
							.set({ id: key.id, key: Buffer.from("private-short-key") }),
					);
					expect((yield* Effect.flip(configs.validateKeys())).message).toBe(
						"Invalid persisted plugin configuration encryption key",
					);
				}),
		);
	});

	layer(sharedDatabaseEncryptionKeyLayer)((test) => {
		test.effect("uses one first-start winner across real concurrent PostgreSQL connections", () => {
			const name = `key_concurrency_${crypto.randomUUID().replaceAll("-", "")}`;
			return Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const statements = yield* baselineMigrationStatements();
				yield* Effect.acquireUseRelease(
					session.transaction(
						session.run((tx) =>
							Effect.gen(function* () {
								yield* tx.execute(sql`create schema ${sql.identifier(name)}`);
								yield* tx.execute(sql`set local search_path to ${sql.identifier(name)}, public`);
								yield* applyBaselineMigration(statements, (statement) =>
									tx.execute(sql.raw(statement)),
								);
							}),
						),
					),
					() =>
						Effect.gen(function* () {
							const ready = yield* Deferred.make<void>();
							let arrivals = 0;
							const results = yield* Effect.all(
								Array.from({ length: 4 }, () =>
									session.transaction(
										session.run((tx) =>
											Effect.gen(function* () {
												yield* tx.execute(
													sql`set local search_path to ${sql.identifier(name)}, public`,
												);
												const [connection] = yield* tx
													.select({ pid: sql<number>`pid` })
													.from(sql`(select pg_backend_pid() as pid) as connection`);
												assert(connection);
												expect(yield* tx.select().from(tables.pluginConfigEncryptionKey)).toEqual(
													[],
												);
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
											}),
										),
									),
								),
								{ concurrency: "unbounded" },
							);
							expect(new Set(results.map((result) => result.pid)).size).toBe(4);
							expect(new Set(results.map((result) => result.envelope.encryptionKeyId)).size).toBe(
								1,
							);
							yield* session.transaction(
								session.run((tx) =>
									Effect.gen(function* () {
										yield* tx.execute(
											sql`set local search_path to ${sql.identifier(name)}, public`,
										);
										const encryption = yield* PluginConfigEncryptionKey;
										const loaded = yield* encryption.load;
										for (const result of results) {
											expect(yield* loaded.decrypt(result.envelope, { owner: "test" })).toEqual({
												token: "shared",
											});
										}
										expect(yield* tx.select().from(tables.pluginConfigEncryptionKey)).toHaveLength(
											1,
										);
									}),
								),
							);
						}),
					() =>
						session
							.run((db) => db.execute(sql`drop schema ${sql.identifier(name)} cascade`))
							.pipe(Effect.orDie),
				);
			});
		});
	});
});
