import { Result, Schema } from "@ryot/client-sdk/effect";
import {
	and,
	ascending,
	column,
	defineRecipe,
	eq,
	isNotNull,
	join,
	literal,
	selectedField,
	selectedRows,
	table,
	type Recipe,
} from "@ryot/client-sdk/ryotql";

const plugin = table("plugin", "plugin");
const installation = table("pluginInstallation", "installation");

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
			selection: {
				slug: selectedField(column(plugin, "slug"), Schema.String),
			},
		}),
	},
	map: ({ installations }) => Result.succeed(installations.items),
}));

export type FixtureClientPluginCatalog = Recipe.Success<typeof fixtureClientPluginCatalogRecipe>;
