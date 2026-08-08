import { EntitySchemaSlug } from "@ryot-app/contract/schema/brands";
import {
	entityDefinitionsRecipe,
	relationshipDefinitionsRecipe,
} from "@ryot-app/ryotql-recipes/definitions";
import { pluginInstallationsRecipe } from "@ryot-app/ryotql-recipes/plugin-installations";
import { providerSearchRecipe } from "@ryot-app/ryotql-recipes/provider-search";
import { Effect } from "effect";

import type { Client } from "~/fixtures/kernel";
import {
	collectRyotQLRecipeItems,
	createAuthenticatedClient,
	executeRyotQLRecipe,
	fakeProviderDetailsResult,
	fakeProviderSearchResult,
	installTestProvider,
	uninstallTestProvider,
} from "~/fixtures/kernel";
import { assertPresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

const listEntities = (client: Client) =>
	collectRyotQLRecipeItems(client, (after) => entityDefinitionsRecipe({ after, limit: 100 }));

const listRelationships = (client: Client) =>
	collectRyotQLRecipeItems(client, (after) => relationshipDefinitionsRecipe({ after, limit: 100 }));

const listPlugins = (client: Client) =>
	collectRyotQLRecipeItems(client, (after) => pluginInstallationsRecipe({ after, limit: 100 }));

describe("Definitions E2E", () => {
	it.live("lists installed entity definitions", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const schemas = yield* listEntities(client);

			expect(Array.isArray(schemas)).toBe(true);
			expect(schemas.length).toBeGreaterThan(0);
			const firstSchema = schemas[0];
			expect(firstSchema?.name).toBeDefined();
			expect(firstSchema?.slug).toBeDefined();
			expect(firstSchema?.icon).toBeDefined();
			expect(firstSchema?.propertiesSchema).toBeDefined();
		}),
	);

	it.live("lists providers from the caller's private plugin installation", () =>
		Effect.gen(function* () {
			const providerName = "Private provider";
			const { client } = yield* createAuthenticatedClient();
			const schemaSlug = `private-provider-entity-${crypto.randomUUID()}`;
			const provider = yield* Effect.acquireRelease(
				installTestProvider({
					client,
					name: providerName,
					rootEntitySchemaSlug: schemaSlug,
					search: fakeProviderSearchResult([]),
					details: fakeProviderDetailsResult({ name: "Private entity" }),
					entitySchemas: [
						{
							icon: "box",
							eventSchemas: [],
							slug: schemaSlug,
							name: "Private entity",
							propertiesSchema: { fields: {} },
						},
					],
				}),
				uninstallTestProvider,
			);

			const schemas = yield* listEntities(client);
			const schema = schemas.find(({ slug }) => slug === schemaSlug);
			assertPresent(schema, "Private entity schema was not listed");
			expect(schema.providers.items).toContainEqual({
				name: providerName,
				providerId: provider.providerId,
			});

			const providers = yield* executeRyotQLRecipe(
				client,
				providerSearchRecipe({ rootEntitySchemaSlug: EntitySchemaSlug.make(schemaSlug) }),
			);
			expect(providers.items).toContainEqual(
				expect.objectContaining({ providerName, providerId: provider.providerId }),
			);

			const outsider = yield* createAuthenticatedClient();
			const outsiderSchemas = yield* listEntities(outsider.client);
			expect(outsiderSchemas.some(({ slug }) => slug === schemaSlug)).toBe(false);
			const outsiderProviders = yield* executeRyotQLRecipe(
				outsider.client,
				providerSearchRecipe({ rootEntitySchemaSlug: EntitySchemaSlug.make(schemaSlug) }),
			);
			expect(outsiderProviders.items).toEqual([]);
		}),
	);

	it.live("includes the built-in collection definition", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const schemas = yield* listEntities(client);
			const collectionSchema = schemas.find((schema) => schema.slug === "collection");
			const movieSchema = schemas.find((schema) => schema.slug === "movie");

			expect(collectionSchema).toBeDefined();
			expect(collectionSchema?.pluginSlug).toBeNull();
			expect(movieSchema?.pluginSlug).toBe("media");
			expect(collectionSchema).toMatchObject({
				icon: "folders",
				name: "Collection",
				propertiesSchema: {
					fields: {
						description: { type: "string", label: "Description" },
						membershipPropertiesSchema: {
							type: "object",
							properties: {},
							unknownKeys: "passthrough",
							label: "Membership Properties Schema",
						},
					},
				},
			});
		}),
	);

	it.live("lists installed relationship definitions", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const schemas = yield* listRelationships(client);
			const selected = schemas.filter((schema) =>
				["in-media-library", "member-of"].includes(schema.slug),
			);

			expect(selected.map((schema) => schema.slug)).toEqual(["in-media-library", "member-of"]);
			expect(selected[0]?.targetEntitySchemaSlug).not.toBeNull();
		}),
	);

	it.live("lists installed plugins", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const [schemas, plugins] = yield* Effect.all([listEntities(client), listPlugins(client)]);
			const selected = plugins.filter((plugin) => ["media", "fitness"].includes(plugin.slug));

			expect(selected.map((plugin) => plugin.slug)).toEqual(
				expect.arrayContaining(["fitness", "media"]),
			);
			expect(selected).toHaveLength(2);
			expect(
				selected.every((plugin) => schemas.some((schema) => schema.pluginSlug === plugin.slug)),
			).toBe(true);
		}),
	);
});
