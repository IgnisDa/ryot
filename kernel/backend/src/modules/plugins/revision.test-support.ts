import { DbError } from "@ryot-app/contract/errors";
import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import { UserId } from "@ryot-app/contract/schema/brands";
import { eq, sql } from "drizzle-orm";
import { Data, Effect, Layer, Redacted } from "effect";
import { assert } from "vitest";

import * as tables from "#lib/infrastructure/db/schema/tables/combined";
import { Database, DatabaseLive } from "#lib/infrastructure/db/service";
import { testDatabaseUrl } from "#lib/test-utils/database";
import { makeAppConfigLayer, makeConfigProviderLayer } from "#lib/test-utils/effect";
import { DefinitionRepository } from "#modules/definition-registry/repository";
import { SandboxRepository } from "#modules/sandbox/repository";

import { PluginConfigEncryptionKey } from "./config-encryption-key";
import { PluginConfigRevisions } from "./config-revisions";
import { PluginInstallationRepository } from "./installation-repository";
import { PluginRepository } from "./repository";
import { PluginRuntimeResolver } from "./runtime-resolver";
import { fixtureManifest } from "./test-support";
import type { NormalizedPlugin } from "./types";

class RollbackTestSchema extends Data.TaggedError("RollbackTestSchema") {}
type Services =
	| Database
	| PluginRepository
	| DefinitionRepository
	| PluginInstallationRepository
	| PluginRuntimeResolver
	| PluginConfigRevisions
	| PluginConfigEncryptionKey
	| SandboxRepository;

export const withRevisionDatabase = <E>(test: Effect.Effect<void, E, Services>) => {
	const name = `revision_test_${crypto.randomUUID().replaceAll("-", "")}`;
	const config = makeAppConfigLayer({ database: { url: Redacted.make(testDatabaseUrl()) } });
	const dependencies = Layer.mergeAll(
		PluginRepository.layer,
		DefinitionRepository.layer,
		PluginInstallationRepository.layer,
		PluginConfigRevisions.layer,
		PluginConfigEncryptionKey.layer,
		SandboxRepository.layer,
	);
	const services = Layer.merge(
		dependencies,
		PluginRuntimeResolver.layer.pipe(Layer.provide(dependencies)),
	).pipe(Layer.provideMerge(DatabaseLive), Layer.provide(config));
	return Effect.gen(function* () {
		const db = yield* Database;
		const directory = new URL("../../drizzle/", import.meta.url).pathname;
		const paths = [...new Bun.Glob("*/migration.sql").scanSync({ cwd: directory })];
		assert(paths.length === 1);
		const ddl = yield* Effect.tryPromise({
			try: () => Bun.file(directory + paths[0]).text(),
			catch: () => new DbError({ message: "Cannot read generated baseline" }),
		});
		yield* db
			.transaction((transaction) =>
				Effect.gen(function* () {
					yield* transaction.execute(sql`create schema ${sql.identifier(name)}`);
					yield* transaction.execute(sql`set local search_path to ${sql.identifier(name)}, public`);
					for (const statement of ddl.split("--> statement-breakpoint")) {
						yield* transaction.execute(sql.raw(statement));
					}
					yield* transaction.insert(tables.user).values([
						{ id: "owner", name: "Owner", preferences: {}, email: "owner@example.test" },
						{
							id: "recipient",
							preferences: {},
							name: "Recipient",
							email: "recipient@example.test",
						},
					]);
					yield* test;
					return yield* new RollbackTestSchema();
				}).pipe(Effect.provideService(Database, transaction)),
			)
			.pipe(Effect.catchTag("RollbackTestSchema", () => Effect.void));
	}).pipe(Effect.provide(Layer.mergeAll(services, makeConfigProviderLayer())));
};

export const revisionPackage = (
	slug = "fixture",
	version = "v1",
	entitySlug = `${slug}-entity`,
): NormalizedPlugin => {
	const fixture = fixtureManifest();
	const entity = fixture.entitySchemas[0];
	assert(entity);
	const common = {
		capabilities: [] as const,
		requiredPluginConfigKeys: [] as const,
		requiredSystemConfigKeys: [] as const,
	};
	const manifest: PluginManifest = {
		...fixture,
		metadata: { ...fixture.metadata, slug, version },
		entitySchemas: [{ ...entity, slug: entitySlug }],
		workflows: [{ slug: `${slug}-flow`, scriptSlug: `${slug}.workflow` }],
		configSchema: {
			unknownKeys: "strict",
			fields: {
				token: { secret: true, type: "string", label: "Token", description: "Private token" },
			},
		},
		relationshipSchemas: [
			{
				name: "Link",
				slug: `${slug}-link`,
				propertiesSchema: { fields: {} },
				sourceEntitySchemaSlug: entitySlug,
				targetEntitySchemaSlug: entitySlug,
			},
		],
		signalSchemas: [
			{
				name: "Signal",
				slug: `${slug}.signal`,
				catalogState: "active",
				propertiesSchema: { fields: {} },
				audiencePolicy: { kind: "actor" },
				notificationHookSlug: `${slug}.notify`,
			},
		],
		providers: [
			{
				name: "Provider",
				slug: `${slug}-provider`,
				rootEntitySchemaSlug: entitySlug,
				information: { source: "fixture" },
				operations: { search: `${slug}.search`, details: `${slug}.details` },
			},
		],
		hooks: [
			{
				name: "Notify",
				stage: "after",
				delivery: "async",
				slug: `${slug}.notify`,
				scriptSlug: `${slug}.automation`,
				targets: [{ operation: "emit", resource: "signal", signalSchemaSlug: `${slug}.signal` }],
			},
		],
		scripts: [
			{
				...common,
				kind: "automation",
				name: "Automation",
				slug: `${slug}.automation`,
				automationType: "automation",
				entry: "backend/automation.sandbox.ts",
				inputProjection: {
					providerEntityImport: true,
					signal: { properties: [] },
					event: { properties: [], compareProperties: [] },
					entity: { properties: [], compareProperties: [], parentEntityProperties: [] },
					relationship: { properties: [], compareProperties: [], parentEntityProperties: [] },
				},
			},
			{
				...common,
				name: "Details",
				kind: "provider",
				slug: `${slug}.details`,
				providerOperation: "details",
				providerSlug: `${slug}-provider`,
				entry: "backend/details.sandbox.ts",
			},
			{
				...common,
				name: "Search",
				kind: "provider",
				slug: `${slug}.search`,
				providerOperation: "search",
				providerSlug: `${slug}-provider`,
				entry: "backend/search.sandbox.ts",
				searchOptionsSchema: { fields: {} },
			},
			{
				...common,
				kind: "workflow",
				name: "Workflow",
				slug: `${slug}.workflow`,
				entry: "backend/workflow.sandbox.ts",
			},
			{
				...common,
				name: "Task",
				kind: "script",
				slug: `${slug}.task`,
				entry: "backend/task.sandbox.ts",
			},
		],
	};
	return {
		manifest,
		sourceHash: `${slug}-${version}`,
		files: { "backend/main.ts": new TextEncoder().encode(version) },
		scripts: manifest.scripts.map(({ entry, ...metadata }) => ({
			entry,
			metadata,
			source: version,
			compiledFormat: 1,
			slug: metadata.slug,
			name: metadata.name,
			compiledCode: version,
			contentHash: `${metadata.slug}-${version}`,
		})),
	};
};

export const installRevisionPackage = Effect.fn(function* (
	packageValue: NormalizedPlugin,
	owner: UserId | null = null,
) {
	const plugins = yield* PluginRepository;
	const installations = yield* PluginInstallationRepository;
	const db = yield* Database;
	const pluginId = yield* plugins.persist(
		packageValue,
		owner
			? { scope: "user", ownerId: owner, slug: packageValue.manifest.metadata.slug }
			: { ownerId: null, scope: "system", slug: packageValue.manifest.metadata.slug },
	);
	const installation = yield* installations.upsertState({
		pluginId,
		config: {},
		sortOrder: 0,
		health: "ready",
		isDisabled: false,
		userId: owner ?? UserId.make("owner"),
	});
	assert(installation);
	const [plugin] = yield* db.select().from(tables.plugin).where(eq(tables.plugin.id, pluginId));
	assert(plugin?.activeRevisionId);
	if (!owner) {
		yield* plugins.resolveEnvironmentConfigs();
	}
	return { pluginId, installation, revisionId: plugin.activeRevisionId };
});
