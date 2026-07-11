import { Result, Schema } from "@ryot-app/client-sdk/effect";
import {
	and,
	ascending,
	column,
	defineRecipe,
	eq,
	isNotNull,
	isNull,
	join,
	literal,
	selectedField,
	selectedRows,
	table,
	type Recipe,
} from "@ryot-app/client-sdk/ryotql";

const plugin = table("plugin", "plugin");
const installation = table("pluginInstallation", "installation");

export const fixtureCollectionChoicesRecipe = defineRecipe(() => {
	const collection = table("entity", "collectionChoice");
	return {
		queries: {
			collections: selectedRows(collection, {
				limit: 100,
				orderBy: [ascending(column(collection, "name")), ascending(column(collection, "id"))],
				where: and(
					eq(column(collection, "entitySchemaSlug"), literal("collection")),
					isNull(column(collection, "entitySchemaPluginId")),
				),
				selection: {
					id: selectedField(column(collection, "id"), Schema.String),
					name: selectedField(column(collection, "name"), Schema.String),
				},
			}),
		},
		map: ({ collections }) => Result.succeed(collections.items),
	};
});

export type FixtureCollectionChoice = Recipe.Success<typeof fixtureCollectionChoicesRecipe>[number];

export const fixturePokemonChoicesRecipe = defineRecipe(() => {
	const pokemon = table("entity", "pokemonChoice");
	return {
		queries: {
			pokemon: selectedRows(pokemon, {
				limit: 100,
				orderBy: [ascending(column(pokemon, "name")), ascending(column(pokemon, "id"))],
				where: eq(column(pokemon, "entitySchemaSlug"), literal("pokemon")),
				selection: {
					id: selectedField(column(pokemon, "id"), Schema.String),
					name: selectedField(column(pokemon, "name"), Schema.String),
				},
			}),
		},
		map: ({ pokemon: pokemonRows }) => Result.succeed(pokemonRows.items),
	};
});

export type FixturePokemonChoice = Recipe.Success<typeof fixturePokemonChoicesRecipe>[number];

export const fixtureClientPluginCatalogRecipe = defineRecipe(() => ({
	queries: {
		installations: selectedRows(installation, {
			limit: 100,
			where: and(
				eq(column(plugin, "status"), literal("active")),
				eq(column(installation, "health"), literal("ready")),
				eq(column(installation, "isDisabled"), literal(false)),
				isNotNull(column(plugin, "clientArtifactHash")),
			),
			orderBy: [ascending(column(plugin, "slug")), ascending(column(installation, "id"))],
			joins: [join("inner", plugin, eq(column(plugin, "id"), column(installation, "pluginId")))],
			selection: { slug: selectedField(column(plugin, "slug"), Schema.String) },
		}),
	},
	map: ({ installations }) => Result.succeed(installations.items),
}));

export type FixtureClientPluginCatalog = Recipe.Success<typeof fixtureClientPluginCatalogRecipe>;
