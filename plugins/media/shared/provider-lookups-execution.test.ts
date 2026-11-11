import { expect, it } from "bun:test";

import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import { EntitySchemaSlug, PluginId, PluginPackageId } from "@ryot-app/contract/schema/brands";
import { fixturePlugin } from "@ryot-app/fixture-plugin";
import { RyotQLService } from "@ryot-app/kernel-backend/modules/ryotql/service";
import {
	MAX_ROOT_PAGE_SIZE,
	savedViewDataSourceAccess,
	validateRyotQLDocument,
} from "@ryot-app/kernel-backend/modules/ryotql/validator";
import { DatabaseSession } from "@ryot-app/kernel-backend/platform/db/session";
import * as tables from "@ryot-app/kernel-backend/schema/tables/combined";
import { makeAppConfigLayer } from "@ryot-app/kernel-backend/testing/effect";
import { isolatedDatabaseLayer } from "@ryot-app/kernel-backend/testing/isolated-database";
import { entityPickerMaterializedRecipe } from "@ryot-app/ryotql-recipes/entity-picker";
import { loadCompleteRows } from "@ryot-app/ryotql-recipes/paging";
import { providerEntityLinksRecipe } from "@ryot-app/ryotql-recipes/provider-entity-links";
import { bindRecipe } from "@ryot-app/ryotql-recipes/test-utils";
import { assert } from "@ryot-app/testing/assert";
import { layer } from "@voila.dev/effect-bun-test";
import { Effect, Layer, Result } from "effect";

const plugins = ["plugin", "other"].map((id) => {
	const packageId = PluginPackageId.make(`example/${id}`);
	const manifest: PluginManifest = {
		crons: [],
		hooks: [],
		scripts: [],
		workflows: [],
		providers: [],
		operations: [],
		savedViews: [],
		entitySchemas: [],
		signalSchemas: [],
		userBootstrap: [],
		importSources: [],
		httpRateLimits: [],
		calendarSources: [],
		relationshipSchemas: [],
		integrationProviders: [],
		metadata: { ...fixturePlugin.metadata, packageId },
		configSchema: { fields: {}, unknownKeys: "strict" },
	};
	return { id, manifest, packageId };
});
const seed = Effect.gen(function* () {
	const session = yield* DatabaseSession;
	yield* session.run((db) =>
		Effect.gen(function* () {
			yield* db
				.insert(tables.user)
				.values({ id: "owner", name: "Owner", email: "provider-lookup@test.local" });
			yield* db
				.insert(tables.plugin)
				.values(plugins.map(({ id, packageId }) => ({ id, packageId, status: "inactive" })));
			for (const { id, manifest, packageId } of plugins) {
				const { metadata, ...sections } = manifest;
				const revisionId = `${id}-revision`;
				yield* db
					.insert(tables.pluginRevision)
					.values({
						...sections,
						...metadata,
						manifest,
						pluginId: id,
						id: revisionId,
						contentHash: id,
						clientConfigSchema: { fields: {} },
						sandboxAuthority: {
							packageId,
							scriptKinds: {},
							workflowScripts: {},
							userBootstrapScriptSlugs: [],
							configSchema: manifest.configSchema,
							schemaScope: {
								eventSchemas: [],
								entitySchemaSlugs: [],
								signalSchemaSlugs: [],
								relationshipSchemaSlugs: [],
							},
						},
					});
			}
			yield* db.execute(
				"update plugin set status = 'active', active_revision_id = id || '-revision'",
			);
			yield* db
				.insert(tables.pluginInstallation)
				.values(
					plugins.map(({ id }) => ({
						pluginId: id,
						userId: "owner",
						isInitialized: true,
						id: `${id}-installation`,
					})),
				);

			yield* db
				.insert(tables.sandboxProvider)
				.values(
					["provider", "elsewhere"].map((id) => ({
						id,
						slug: id,
						name: id,
						pluginId: "plugin",
						rootEntitySchemaSlug: "item",
						information: { source: "fixture" },
					})),
				);
			yield* db
				.insert(tables.entity)
				.values(
					[
						{
							id: "library",
							name: "Library",
							entitySchemaSlug: "library",
							entitySchemaPluginId: "plugin",
						},
						...Array.from({ length: 207 }, (_, index) => ({
							name: "Item",
							providerId: "provider",
							entitySchemaSlug: "item",
							entitySchemaPluginId: "plugin",
							externalId: `ext-${index % 205}`,
							userId: index < 205 ? "owner" : null,
							id: `item-${String(index).padStart(3, "0")}`,
						})),
						{
							name: "Foreign",
							id: "foreign-provider",
							providerId: "elsewhere",
							entitySchemaSlug: "item",
							entitySchemaPluginId: "plugin",
							externalId: "excluded-provider",
						},
						{
							name: "Foreign",
							id: "foreign-owner",
							providerId: "provider",
							entitySchemaSlug: "item",
							externalId: "excluded-owner",
							entitySchemaPluginId: "other",
						},
						{
							name: "Foreign",
							id: "foreign-schema",
							providerId: "provider",
							entitySchemaSlug: "other",
							externalId: "excluded-schema",
							entitySchemaPluginId: "plugin",
						},
					].map((entity) => Object.assign({ userId: "owner" }, entity)),
				);
			yield* db
				.insert(tables.relationship)
				.values(
					Array.from({ length: 207 }, (_, index) => ({
						id: `r${index}`,
						userId: "owner",
						targetEntityId: "library",
						relationshipSchemaSlug: "member",
						relationshipSchemaPluginId: "plugin",
						sourceEntityId: `item-${String(index).padStart(3, "0")}`,
					})),
				);
		}),
	);
});
const database = Layer.merge(RyotQLService.layer, Layer.effectDiscard(seed)).pipe(
	Layer.provideMerge(isolatedDatabaseLayer("provider_lookups")),
	Layer.provide(makeAppConfigLayer()),
);
layer(database)((test) => {
	test.effect(
		"executes bounded provider recipes with complete selections and exact ownership",
		() =>
			Effect.gen(function* () {
				const service = yield* RyotQLService;
				const externalIds = [
					...Array.from({ length: 205 }, (_, index) => `ext-${index}`),
					"ext-0",
					"missing",
					"excluded-provider",
					"excluded-owner",
					"excluded-schema",
				];
				const reference = { kind: "local", pluginId: PluginId.make("plugin") } as const;
				const linksRecipe = providerEntityLinksRecipe({
					reference,
					relationshipSlug: "member",
					librarySchemaSlug: "library",
					entitySchemaSlug: EntitySchemaSlug.make("item"),
				});
				const materializedRecipe = entityPickerMaterializedRecipe({
					schema: {
						slug: EntitySchemaSlug.make("item"),
						owner: { kind: "plugin", pluginId: PluginId.make("plugin") },
					},
				});
				const args = { externalIds, providerId: "provider" };
				const links = yield* loadCompleteRows((after) =>
					service
						.executeForUser("owner", null, "plugin", {
							arguments: args,
							pages: { links: { after } },
							source: { kind: "inline", document: linksRecipe.document },
						})
						.pipe(Effect.map((response) => Result.getOrThrow(linksRecipe.decode(response)))),
				);
				const materialized = yield* loadCompleteRows((after) =>
					service
						.executeForUser("owner", null, "plugin", {
							arguments: args,
							pages: { materialized: { after } },
							source: { kind: "inline", document: materializedRecipe.document },
						})
						.pipe(Effect.map((response) => Result.getOrThrow(materializedRecipe.decode(response)))),
				);
				expect(links).toHaveLength(207);
				expect(materialized).toHaveLength(207);
				expect(new Set(materialized.map((row) => row.externalId))).toEqual(
					new Set(externalIds.slice(0, 205)),
				);
				expect(links.map((row) => row.externalId)).toEqual(
					materialized.map((row) => row.externalId),
				);
			}),
	);
});

it("validates provider lookup pages against the unchanged root cap", () => {
	expect(MAX_ROOT_PAGE_SIZE).toBe(100);
	const recipe = entityPickerMaterializedRecipe({
		schema: { owner: { kind: "kernel" }, slug: EntitySchemaSlug.make("item") },
	});
	const document = bindRecipe(recipe, {
		providerId: "provider",
		externalIds: ["external"],
	}).document;
	expect(validateRyotQLDocument(document, savedViewDataSourceAccess).error).toBeNull();
	const materialized = document.queries.materialized;
	assert(materialized?.output.type === "rows");
	expect(
		validateRyotQLDocument(
			{
				...document,
				queries: {
					materialized: {
						...materialized,
						output: { ...materialized.output, pagination: { limit: 1000 } },
					},
				},
			},
			savedViewDataSourceAccess,
		).error,
	).toBe("Query 'materialized': Rows limit must not exceed 100");
});
