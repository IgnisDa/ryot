import { BunCrypto } from "@effect/platform-bun";
import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import { UserId } from "@ryot-app/contract/schema/brands";
import type { Entitlement } from "@ryot-app/contract/schema/entitlement";
import { fixtureManifest, manifestCatalogs, testPluginPackageId } from "@ryot-app/contract/testing";
import { assert } from "@ryot-app/testing/assert";
import { randomUuid } from "@ryot-app/testing/random";
import { eq, sql } from "drizzle-orm";
import { Effect, Layer, Redacted } from "effect";

import { DefinitionCatalog } from "#modules/definitions/catalog";
import { DefinitionRepository } from "#modules/definitions/repository";
import { ClientArtifactsRepository } from "#modules/pages/bundles/repository";
import { SandboxRepository } from "#modules/scripts/registry/repository";
import { SandboxWorkflowReferenceRepository } from "#modules/scripts/registry/workflow-references";
import { DatabaseSession } from "#platform/db/session";
import * as tables from "#schema/tables/combined";
import { applyBaselineMigration, baselineMigrationStatements } from "#testing/baseline-migration";
import { testDatabaseUrl } from "#testing/database";
import { makeAppConfigLayer, makeConfigProviderLayer } from "#testing/effect";

import { PluginRuntimeResolver } from "../catalog/runtime-resolver";
import { PluginConfigEncryptionKey } from "../configuration/encryption-key";
import { PluginConfigRevisions } from "../configuration/revisions";
import { PluginInstallationRepository } from "../installations/repository";
import { pluginContentHash } from "./pipeline";
import { PluginRepository } from "./repository";
import type { NormalizedPlugin } from "./types";

export const revisionDatabaseLayer = Layer.unwrap(
	Effect.gen(function* () {
		const name = `revision_test_${(yield* randomUuid).replaceAll("-", "")}`;
		const databaseUrl = new URL(yield* testDatabaseUrl);
		const options = databaseUrl.searchParams.get("options");
		databaseUrl.searchParams.set(
			"options",
			`${options ? `${options} ` : ""}-c search_path=${name},public`,
		);
		const config = makeAppConfigLayer({ database: { url: Redacted.make(databaseUrl.href) } });
		const dependencies = Layer.mergeAll(
			ClientArtifactsRepository.layer,
			DefinitionCatalog.layer,
			DefinitionRepository.layer,
			PluginInstallationRepository.layer,
			PluginConfigRevisions.layer,
			PluginConfigEncryptionKey.layer,
			SandboxRepository.layer,
			SandboxWorkflowReferenceRepository.layer,
		);
		const repositoryLayer = PluginRepository.layer.pipe(Layer.provide(dependencies));
		const services = Layer.mergeAll(
			dependencies,
			repositoryLayer,
			PluginRuntimeResolver.layer.pipe(Layer.provide(Layer.merge(repositoryLayer, dependencies))),
		).pipe(Layer.provideMerge(DatabaseSession.layer), Layer.provide(config));
		const schemaLayer = Layer.effectDiscard(
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const statements = yield* baselineMigrationStatements();
				yield* Effect.acquireRelease(
					session.run((db) => db.execute(sql`create schema ${sql.identifier(name)}`)),
					() =>
						session
							.run((db) => db.execute(sql`drop schema ${sql.identifier(name)} cascade`))
							.pipe(Effect.orDie),
				);
				yield* session.transaction(
					session.run((transaction) =>
						Effect.gen(function* () {
							yield* applyBaselineMigration(statements, (statement) =>
								transaction.execute(sql.raw(statement)),
							);
							yield* transaction.insert(tables.user).values([
								{ id: "owner", name: "Owner", email: "owner@example.test" },
								{ id: "recipient", name: "Recipient", email: "recipient@example.test" },
							]);
						}),
					),
				);
			}),
		);
		return schemaLayer.pipe(
			Layer.provideMerge(services),
			Layer.provideMerge(makeConfigProviderLayer()),
		);
	}),
).pipe(Layer.provideMerge(BunCrypto.layerSecureRandom));

export const revisionPackage = (
	slug = "fixture",
	version = "v1",
	entitySlug = `${slug}-entity`,
	packageId = testPluginPackageId(),
): NormalizedPlugin => {
	const fixture = fixtureManifest(packageId);
	const entity = fixture.entitySchemas[0];
	assert(entity);
	const common = {
		runtimeImports: [],
		capabilities: [] as const,
		oauthConnectionFields: [] as const,
		executableDependencies: [] as const,
		requiredPluginConfigKeys: [] as const,
		optionalPluginConfigKeys: [] as const,
	};
	const manifest: PluginManifest = {
		...fixture,
		metadata: { ...fixture.metadata, version },
		entitySchemas: [{ ...entity, slug: entitySlug }],
		workflows: [{ slug: `${slug}-flow`, scriptSlug: `${slug}.workflow` }],
		providers: [
			{
				slug: `${slug}-provider`,
				name: { key: "test.provider" },
				rootEntitySchemaSlug: entitySlug,
				information: { source: "fixture" },
			},
		],
		configSchema: {
			unknownKeys: "strict",
			fields: {
				token: {
					secret: true,
					type: "string",
					label: { key: "test.token" },
					description: "Private token",
				},
			},
		},
		relationshipSchemas: [
			{
				slug: `${slug}-link`,
				name: { key: "test.link" },
				propertiesSchema: { fields: {} },
				sourceEntitySchemaSlug: entitySlug,
				targetEntitySchemaSlug: entitySlug,
			},
		],
		signalSchemas: [
			{
				slug: `${slug}.signal`,
				catalogState: "active",
				name: { key: "test.signal" },
				propertiesSchema: { fields: {} },
				audiencePolicy: { kind: "actor" },
				notificationHookSlug: `${slug}.notify`,
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
		contentHash: `${slug}-${version}`,
		catalogs: manifestCatalogs(manifest),
		scripts: manifest.scripts.map(({ entry, ...metadata }) => ({
			entry,
			metadata,
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
	owner: null | UserId = null,
) {
	const session = yield* DatabaseSession;
	const plugins = yield* PluginRepository;
	const installations = yield* PluginInstallationRepository;
	return yield* session
		.transaction(
			Effect.gen(function* () {
				yield* plugins.lockIngestion();
				const pluginId = yield* plugins.persist(
					packageValue,
					owner ? { scope: "user", ownerId: owner } : { ownerId: null, scope: "system" },
				);
				const installation = yield* installations.upsertState({
					pluginId,
					config: {},
					sortOrder: 0,
					health: "ready",
					isHidden: false,
					userId: owner ?? UserId.make("owner"),
				});
				assert(installation);
				const [plugin] = yield* (yield* DatabaseSession).run((db) =>
					db.select().from(tables.plugin).where(eq(tables.plugin.id, pluginId)),
				);
				assert(plugin?.activeRevisionId);
				if (!owner) {
					yield* plugins.resolveEnvironmentConfigs();
				}
				return { pluginId, installation, revisionId: plugin.activeRevisionId };
			}),
		)
		.pipe(Effect.catchTag("DatabaseSessionStateError", Effect.die));
});

const oauthConnectionField = (key: string) => ({
	label: { key },
	type: "string" as const,
	description: "Linked account",
	format: { provider: "account", kind: "oauth-connection" as const },
});

export const oauthRevisionPackage = (
	slug: string,
	integrationProviderSlug: string,
	options: {
		readonly pkce?: "S256" | "none";
		readonly entitlement?: Entitlement;
		readonly accessTokenLifetimeSeconds?: number;
	} = {},
) => {
	const plugin = revisionPackage(slug, "v1");
	const manifest = {
		...plugin.manifest,
		configSchema: {
			unknownKeys: "strict" as const,
			fields: {
				clientId: {
					type: "string" as const,
					description: "Client ID",
					label: { key: "test.client-id" },
				},
				clientSecret: {
					secret: true as const,
					type: "string" as const,
					description: "Client secret",
					label: { key: "test.client-secret" },
				},
			},
		},
		oauthProviders: [
			{
				slug: "account",
				scopes: ["read", "offline"],
				pkce: options.pkce ?? "S256",
				name: { key: "test.account" },
				...(options.accessTokenLifetimeSeconds === undefined
					? {}
					: { accessTokenLifetimeSeconds: options.accessTokenLifetimeSeconds }),
				clientIdConfigKey: "clientId",
				clientSecretConfigKey: "clientSecret",
				tokenUrl: "https://accounts.example.test/token",
				tokenEndpointAuth: "client_secret_basic" as const,
				authorizeUrl: "https://accounts.example.test/authorize?prompt=consent",
			},
		],
		integrationProviders: [
			{
				lot: "yank" as const,
				scriptSlug: `${slug}.task`,
				slug: integrationProviderSlug,
				name: { key: "test.oauth-yank" },
				...(options.entitlement === undefined ? {} : { entitlement: options.entitlement }),
				description: { key: "test.yank-with-a-linked-account" },
				settingsSchema: {
					fields: {
						account: oauthConnectionField("test.account"),
						backup: oauthConnectionField("test.backup-account"),
						endpoint: {
							type: "string" as const,
							description: "Endpoint",
							label: { key: "test.endpoint" },
						},
					},
				},
			},
		],
	};
	return {
		...plugin,
		manifest,
		catalogs: manifestCatalogs(manifest),
		contentHash: pluginContentHash(
			manifest,
			manifestCatalogs(manifest),
			plugin.scripts.map(({ entry, compiledCode, compiledFormat }) => ({
				entry,
				format: compiledFormat,
				javascript: compiledCode,
			})),
			plugin.compiledClient,
		),
	};
};
