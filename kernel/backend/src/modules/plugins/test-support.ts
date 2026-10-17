import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import { PluginPackageId } from "@ryot-app/contract/schema/brands";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { emptySandboxExecutionMetadata } from "@ryot-app/contract/testing";
import { sql } from "drizzle-orm";
import type { EffectPgDatabase } from "drizzle-orm/effect-postgres";
import { Effect } from "effect";

import { pluginSandboxAuthority } from "#modules/scripts/authorization/plugin-authority";
import { pluginRevisionSections } from "#platform/db/immutable-revisions";
import { pluginRevision, pluginRevisionManifest } from "#schema/tables/core";

export const fixturePackageRoot = (kind: "diagnostic" | "valid" = "valid") =>
	new URL(`./test-fixtures/${kind}`, import.meta.url).pathname;

const fixturePackageId = PluginPackageId.make("test/fixture");

export const testPluginPackageId = () => PluginPackageId.make(`test/${crypto.randomUUID()}`);

export const fixturePluginIdentity = (name = "fixture", packageId = fixturePackageId) =>
	({ packageId, ownerId: null, scope: "system", id: `${name}-plugin-id` }) as const;

export const fixtureManifest = (packageId = fixturePackageId) =>
	({
		savedViews: [],
		httpRateLimits: [],
		crons: [] as PluginManifest["crons"],
		workflows: [] as PluginManifest["workflows"],
		providers: [] as PluginManifest["providers"],
		operations: [] as PluginManifest["operations"],
		configSchema: { fields: {}, unknownKeys: "strict" },
		userBootstrap: [] as PluginManifest["userBootstrap"],
		importSources: [] as PluginManifest["importSources"],
		integrationProviders: [] as PluginManifest["integrationProviders"],
		metadata: {
			packageId,
			icon: "box",
			name: "Fixture",
			version: "1.0.0",
			description: "Fixture plugin",
		},
		relationshipSchemas: [
			{
				name: "Fixture Link",
				slug: "fixture-link",
				propertiesSchema: { fields: {} },
				sourceEntitySchemaSlug: "fixture-entity",
				targetEntitySchemaSlug: "fixture-entity",
			},
		],
		signalSchemas: [
			{
				name: "Fixture Signal",
				slug: "fixture.signal",
				catalogState: "active",
				propertiesSchema: { fields: {} },
				audiencePolicy: { kind: "actor" },
				notificationHookSlug: "fixture.automation",
			},
		],
		scripts: [
			{
				...emptySandboxExecutionMetadata,
				kind: "automation",
				name: "Fixture Automation",
				slug: "fixture.automation",
				automationType: "automation",
				entry: "backend/automations/fixture.sandbox.ts",
				inputProjection: {
					signal: { properties: [] },
					entity: { properties: [], compareProperties: [], parentEntityProperties: [] },
				},
			},
		],
		hooks: [
			{
				stage: "after",
				delivery: "async",
				slug: "fixture.automation",
				name: "Fixture automation",
				scriptSlug: "fixture.automation",
				targets: [
					{ resource: "entity", operation: "create", entitySchemaSlug: "fixture-entity" },
					{ operation: "emit", resource: "signal", signalSchemaSlug: "fixture.signal" },
				],
			},
		] as PluginManifest["hooks"],
		entitySchemas: [
			{
				icon: "box",
				name: "Fixture",
				slug: "fixture-entity",
				eventSchemas: [
					{
						name: "Changed",
						slug: "changed",
						propertiesSchema: {
							fields: { value: { type: "string", label: "Value", description: "Changed value" } },
						},
					},
				],
				propertiesSchema: {
					fields: {
						name: { label: "Name", type: "string", description: "Fixture name" },
						kind: {
							type: "enum",
							label: "Kind",
							description: "Fixture kind",
							choices: { kind: "static", values: [{ value: "one" }, { value: "two" }] },
						},
					},
				},
			},
		],
	}) satisfies PluginManifest;

export const insertPluginRevision = (
	db: EffectPgDatabase,
	revision: {
		readonly id: string;
		readonly pluginId: string;
		readonly contentHash: string;
		readonly manifest: PluginManifest;
		readonly clientConfigSchema?: AppSchema;
	},
) =>
	db.transaction((tx) =>
		Effect.gen(function* () {
			yield* tx
				.insert(pluginRevision)
				.select((qb) =>
					qb
						.select({
							...pluginRevisionSections(sql`source.manifest`),
							id: sql`${revision.id}`.as("id"),
							pluginId: sql`${revision.pluginId}`.as("plugin_id"),
							contentHash: sql`${revision.contentHash}`.as("content_hash"),
							sandboxAuthority:
								sql`${JSON.stringify(pluginSandboxAuthority(revision.manifest))}::jsonb`.as(
									"sandbox_authority",
								),
							clientConfigSchema:
								sql`${JSON.stringify(revision.clientConfigSchema ?? { fields: {} })}::jsonb`.as(
									"client_config_schema",
								),
						})
						.from(sql`(select ${JSON.stringify(revision.manifest)}::jsonb as manifest) as source`),
				);
			yield* tx
				.insert(pluginRevisionManifest)
				.values({ manifest: revision.manifest, pluginRevisionId: revision.id });
		}),
	);
