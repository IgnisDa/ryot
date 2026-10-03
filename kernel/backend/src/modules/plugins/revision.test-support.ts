import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import { UserId } from "@ryot-app/contract/schema/brands";
import { eq, sql } from "drizzle-orm";
import { Effect, Layer, Redacted } from "effect";
import { assert } from "vitest";

import * as tables from "#lib/infrastructure/db/schema/tables/combined";
import { DatabaseSession } from "#lib/infrastructure/db/session";
import {
	applyBaselineMigration,
	baselineMigrationStatements,
} from "#lib/test-utils/baseline-migration";
import { testDatabaseUrl } from "#lib/test-utils/database";
import { makeAppConfigLayer, makeConfigProviderLayer } from "#lib/test-utils/effect";
import { ClientArtifactsRepository } from "#modules/client-artifacts/repository";
import { DefinitionRepository } from "#modules/definition-registry/repository";
import { SandboxRepository } from "#modules/sandbox/repository";
import { SandboxWorkflowReferenceRepository } from "#modules/sandbox/workflow-reference-repository";

import { PluginConfigEncryptionKey } from "./config-encryption-key";
import { PluginConfigRevisions } from "./config-revisions";
import { PluginInstallationRepository } from "./installation-repository";
import { pluginSourceHash } from "./pipeline";
import { PluginRepository } from "./repository";
import { PluginRuntimeResolver } from "./runtime-resolver";
import { fixtureManifest } from "./test-support";
import type { NormalizedPlugin } from "./types";

export const revisionDatabaseLayer = Layer.unwrap(
	Effect.sync(() => {
		const name = `revision_test_${crypto.randomUUID().replaceAll("-", "")}`;
		const databaseUrl = new URL(testDatabaseUrl());
		const options = databaseUrl.searchParams.get("options");
		databaseUrl.searchParams.set(
			"options",
			`${options ? `${options} ` : ""}-c search_path=${name},public`,
		);
		const config = makeAppConfigLayer({
			database: { poolMax: 1, url: Redacted.make(databaseUrl.href) },
		});
		const dependencies = Layer.mergeAll(
			ClientArtifactsRepository.layer,
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
								{
									id: "owner",
									name: "Owner",
									email: "owner@example.test",
									accountGeneration: "test-account-generation",
								},
								{
									id: "recipient",
									name: "Recipient",
									email: "recipient@example.test",
									accountGeneration: "test-account-generation",
								},
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
);

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
		oauthConnectionFields: [] as const,
		executableDependencies: [] as const,
		requiredPluginConfigKeys: [] as const,
		optionalPluginConfigKeys: [] as const,
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
	owner: UserId | null = null,
) {
	const plugins = yield* PluginRepository;
	const installations = yield* PluginInstallationRepository;
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
});

const oauthConnectionField = (label: string) => ({
	label,
	type: "string" as const,
	description: "Linked account",
	format: { provider: "account", kind: "oauth-connection" as const },
});

export const oauthRevisionPackage = (
	slug: string,
	integrationProviderSlug: string,
	options: {
		readonly accessTokenLifetimeSeconds?: number;
		readonly pkce?: "S256" | "none";
		readonly requiresProKey?: boolean;
	} = {},
) => {
	const plugin = revisionPackage(slug, "v1");
	const manifest = {
		...plugin.manifest,
		configSchema: {
			unknownKeys: "strict" as const,
			fields: {
				clientId: { label: "Client ID", type: "string" as const, description: "Client ID" },
				clientSecret: {
					secret: true as const,
					label: "Client secret",
					type: "string" as const,
					description: "Client secret",
				},
			},
		},
		integrationProviders: [
			{
				name: "OAuth yank",
				lot: "yank" as const,
				scriptSlug: `${slug}.task`,
				slug: integrationProviderSlug,
				...(options.requiresProKey === undefined ? {} : { requiresProKey: options.requiresProKey }),
				description: "Yank with a linked account",
				settingsSchema: {
					fields: {
						account: oauthConnectionField("Account"),
						backup: oauthConnectionField("Backup account"),
						endpoint: { label: "Endpoint", type: "string" as const, description: "Endpoint" },
					},
				},
			},
		],
		oauthProviders: [
			{
				slug: "account",
				name: "Account",
				scopes: ["read", "offline"],
				pkce: options.pkce ?? "S256",
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
	};
	return {
		...plugin,
		manifest,
		sourceHash: pluginSourceHash(
			manifest,
			plugin.scripts.map(({ entry, compiledCode, compiledFormat }) => ({
				entry,
				format: compiledFormat,
				javascript: compiledCode,
			})),
			plugin.compiledClient,
		),
	};
};
