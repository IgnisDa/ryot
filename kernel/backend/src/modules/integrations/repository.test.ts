import { expect, it } from "@effect/vitest";
import { IntegrationId, UserId } from "@ryot-app/contract/schema/brands";
import { sql } from "drizzle-orm";
import { Deferred, Effect, Fiber, Layer, Redacted } from "effect";
import { assert, describe } from "vitest";

import * as tables from "#lib/infrastructure/db/schema/tables/combined";
import { Database, DatabaseLive } from "#lib/infrastructure/db/service";
import { testDatabaseUrl } from "#lib/test-utils/database";
import { makeAppConfigLayer, makeConfigProviderLayer } from "#lib/test-utils/effect";
import { DefinitionRepository } from "#modules/definition-registry/repository";
import { PluginConfigEncryptionKey } from "#modules/plugins/config-encryption-key";
import { PluginConfigRevisions } from "#modules/plugins/config-revisions";
import { PluginIngestionLock } from "#modules/plugins/ingestion-lock";
import { PluginInstallationRepository } from "#modules/plugins/installation-repository";
import { PluginRepository } from "#modules/plugins/repository";
import {
	installRevisionPackage,
	revisionPackage,
	withRevisionDatabase,
} from "#modules/plugins/revision.test-support";

import { IntegrationPluginRevisionActivationLive, IntegrationsRepository } from "./repository";

const owner = UserId.make("owner");
const timestamp = new Date("2026-09-23T00:00:00.000Z");

const providerPackage = (version: string, endpointSecret: boolean) => {
	const plugin = revisionPackage("notes", version);
	return {
		...plugin,
		manifest: {
			...plugin.manifest,
			integrationProviders: [
				{
					slug: "notes-push",
					name: "Notes push",
					lot: "push" as const,
					description: "Push progress to notes",
					settingsSchema: {
						fields: {
							token: { secret: true, type: "string", label: "Token", description: "API token" },
							endpoint: {
								type: "string",
								label: "Endpoint",
								description: "Server URL",
								...(endpointSecret ? { secret: true } : {}),
							},
						},
					},
				},
			],
		},
	} satisfies typeof plugin;
};

const integration = {
	isDisabled: false,
	lot: "push" as const,
	syncOwnership: false,
	minimumProgress: "2",
	maximumProgress: "95",
	extraSettings: { disableOnContinuousErrors: false },
};

const repositoryLayer = IntegrationsRepository.layer.pipe(Layer.provide(makeAppConfigLayer()));

const withCommittedDatabase = <E>(
	test: Effect.Effect<
		void,
		E,
		| Database
		| IntegrationsRepository
		| PluginIngestionLock
		| PluginRepository
		| PluginInstallationRepository
	>,
) => {
	const name = `integration_race_${crypto.randomUUID().replaceAll("-", "")}`;
	const url = testDatabaseUrl();
	const root = DatabaseLive.pipe(
		Layer.provide(makeAppConfigLayer({ database: { url: Redacted.make(url) } })),
	);
	return Effect.gen(function* () {
		const admin = yield* Database;
		const directory = new URL("../../drizzle/", import.meta.url).pathname;
		const paths = [...new Bun.Glob("*/migration.sql").scanSync({ cwd: directory })];
		assert(paths.length === 1);
		const ddl = yield* Effect.promise(() => Bun.file(directory + paths[0]).text());
		yield* admin.execute(sql`create database ${sql.identifier(name)}`);
		const scopedUrl = new URL(url);
		scopedUrl.pathname = `/${name}`;
		const config = makeAppConfigLayer({ database: { url: Redacted.make(scopedUrl.toString()) } });
		const database = DatabaseLive.pipe(Layer.provide(config), Layer.fresh);
		const repositories = Layer.mergeAll(
			PluginRepository.layer,
			PluginInstallationRepository.layer,
			IntegrationsRepository.layer,
		).pipe(
			Layer.provideMerge(
				Layer.mergeAll(
					DefinitionRepository.layer,
					PluginConfigRevisions.layer,
					PluginConfigEncryptionKey.layer,
				),
			),
			Layer.provide(config),
		);
		const services = PluginIngestionLock.layer.pipe(
			Layer.provide(IntegrationPluginRevisionActivationLive),
			Layer.provideMerge(repositories),
			Layer.provideMerge(database),
		);
		yield* Effect.gen(function* () {
			const db = yield* Database;
			for (const statement of ddl.split("--> statement-breakpoint")) {
				yield* db.execute(sql.raw(statement));
			}
			yield* db
				.insert(tables.user)
				.values({ id: owner, name: "Owner", preferences: {}, email: "owner@example.test" });
			yield* test;
		}).pipe(
			Effect.provide(services),
			Effect.ensuring(admin.execute(sql`drop database ${sql.identifier(name)}`).pipe(Effect.orDie)),
		);
	}).pipe(Effect.provide(root.pipe(Layer.provideMerge(makeConfigProviderLayer()))));
};

const waitForLockedTransaction = Effect.fn(function* (attempts = 2_000) {
	const db = yield* Database;
	for (let attempt = 0; attempt < attempts; attempt += 1) {
		const [waiting] = yield* db.execute<{ readonly count: number }>(
			sql`select count(*)::int as count from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'`,
			"objects",
		);
		if ((waiting?.count ?? 0) > 0) {
			return true;
		}
	}
	return false;
});

describe("integration client settings projection", () => {
	it.effect("strips secrets on create and update and recomputes when the revision changes", () =>
		withRevisionDatabase(
			Effect.gen(function* () {
				const installed = yield* installRevisionPackage(providerPackage("v1", false), owner);
				const integrations = yield* IntegrationsRepository;
				const created = yield* integrations.createForUser({
					...integration,
					userId: owner,
					provider: "notes-push",
					pluginInstallationId: installed.installation.id,
					providerSpecifics: { kind: "notes", token: "secret-a", endpoint: "https://notes.test" },
				});
				expect(
					(yield* integrations.getForUser({ userId: owner, integrationId: created.id }))
						?.providerSpecifics,
				).toMatchObject({ token: "secret-a" });
				const client = integrations
					.getClientForUser({ userId: owner, integrationId: created.id })
					.pipe(Effect.map((row) => row?.providerSpecifics));
				expect(yield* client).toEqual({ kind: "notes", endpoint: "https://notes.test" });
				yield* integrations.updateForUser({
					userId: owner,
					integrationId: created.id,
					providerSpecifics: { kind: "notes", token: "secret-b", endpoint: "https://other.test" },
				});
				expect(yield* client).toEqual({ kind: "notes", endpoint: "https://other.test" });
				yield* (yield* PluginIngestionLock).persistUserPlugin(providerPackage("v2", true), {
					slug: "notes",
					scope: "user",
					ownerId: owner,
				});
				expect(yield* client).toEqual({ kind: "notes" });
			}).pipe(
				Effect.provide(
					PluginIngestionLock.layer.pipe(
						Layer.provide(IntegrationPluginRevisionActivationLive),
						Layer.provideMerge(repositoryLayer),
					),
				),
			),
		),
	);

	it.effect("computes restored settings and keeps only the kind for an undeclared provider", () =>
		withRevisionDatabase(
			Effect.gen(function* () {
				const installed = yield* installRevisionPackage(providerPackage("v1", false), owner);
				const integrations = yield* IntegrationsRepository;
				const restore = (id: string, provider: string) =>
					integrations.restoreForUser({
						...integration,
						id,
						provider,
						name: null,
						userId: owner,
						lastFinishedAt: null,
						createdAt: timestamp,
						updatedAt: timestamp,
						pluginInstallationId: installed.installation.id,
						providerSpecifics: { kind: "notes", token: "secret", endpoint: "https://notes.test" },
					});
				const client = (id: string) =>
					integrations
						.getClientForUser({ userId: owner, integrationId: IntegrationId.make(id) })
						.pipe(Effect.map((row) => row?.providerSpecifics));
				yield* restore("declared", "notes-push");
				yield* restore("undeclared", "removed-push");
				expect(yield* client("declared")).toEqual({
					kind: "notes",
					endpoint: "https://notes.test",
				});
				expect(yield* client("undeclared")).toEqual({ kind: "notes" });
			}).pipe(Effect.provide(repositoryLayer)),
		),
	);

	it.effect(
		"recomputes settings from the committed revision when a save races a revision change",
		() =>
			withCommittedDatabase(
				Effect.gen(function* () {
					const db = yield* Database;
					const integrations = yield* IntegrationsRepository;
					const inTransaction = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
						db.transaction((transaction) =>
							effect.pipe(Effect.provideService(Database, transaction)),
						);
					const installed = yield* inTransaction(
						installRevisionPackage(providerPackage("v1", false), owner),
					);
					const created = yield* inTransaction(
						integrations.createForUser({
							...integration,
							userId: owner,
							provider: "notes-push",
							pluginInstallationId: installed.installation.id,
							providerSpecifics: {
								kind: "notes",
								token: "secret-a",
								endpoint: "https://notes.test",
							},
						}),
					);
					const persisted = yield* Deferred.make<void>();
					const release = yield* Deferred.make<void>();
					const revisionChange = yield* Effect.forkChild(
						inTransaction(
							Effect.gen(function* () {
								yield* (yield* PluginIngestionLock).persistUserPlugin(providerPackage("v2", true), {
									slug: "notes",
									scope: "user",
									ownerId: owner,
								});
								yield* Deferred.succeed(persisted, undefined);
								yield* Deferred.await(release);
							}),
						),
					);
					yield* Deferred.await(persisted);
					const save = yield* Effect.forkChild(
						inTransaction(
							integrations.updateForUser({
								userId: owner,
								integrationId: created.id,
								providerSpecifics: {
									kind: "notes",
									token: "secret-b",
									endpoint: "https://other.test",
								},
							}),
						),
					);
					expect(yield* waitForLockedTransaction()).toBe(true);
					yield* Deferred.succeed(release, undefined);
					yield* Fiber.join(revisionChange);
					yield* Fiber.join(save);
					const client = yield* integrations.getClientForUser({
						userId: owner,
						integrationId: created.id,
					});
					expect(client?.providerSpecifics).toEqual({ kind: "notes" });
					expect(
						(yield* integrations.getForUser({ userId: owner, integrationId: created.id }))
							?.providerSpecifics,
					).toMatchObject({ endpoint: "https://other.test" });
				}),
			),
	);
});
