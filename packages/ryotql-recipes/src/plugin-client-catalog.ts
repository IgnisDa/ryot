import { PluginInstallationHealth } from "@ryot-app/contract/modules/plugins/schemas";
import { SavedViewId } from "@ryot-app/contract/schema/brands";
import {
	ascending,
	and,
	column,
	defineRecipe,
	eq,
	join,
	isNotNull,
	literal,
	selectedField,
	selectedRows,
	table,
	type Recipe,
} from "@ryot-app/ryotql";
import { Result, Schema } from "effect";

const plugin = table("plugin", "plugin");
const installation = table("pluginInstallation", "installation");

export const pluginClientCatalogRecipe = defineRecipe(
	(input: { readonly after?: string | undefined } = {}) => ({
		queries: {
			installations: selectedRows(installation, {
				limit: 100,
				after: input.after,
				joins: [join("inner", plugin, eq(column(plugin, "id"), column(installation, "pluginId")))],
				where: and(
					eq(column(plugin, "status"), literal("active")),
					isNotNull(column(plugin, "clientApiVersion")),
				),
				orderBy: [
					ascending(column(installation, "sortOrder")),
					ascending(column(plugin, "slug")),
					ascending(column(installation, "id")),
				],
				selection: {
					name: selectedField(column(plugin, "name"), Schema.String),
					slug: selectedField(column(plugin, "slug"), Schema.String),
					icon: selectedField(column(plugin, "icon"), Schema.String),
					pluginId: selectedField(column(plugin, "id"), Schema.String),
					sourceHash: selectedField(column(plugin, "sourceHash"), Schema.String),
					installationId: selectedField(column(installation, "id"), Schema.String),
					sortOrder: selectedField(column(installation, "sortOrder"), Schema.Number),
					isDisabled: selectedField(column(installation, "isDisabled"), Schema.Boolean),
					health: selectedField(column(installation, "health"), PluginInstallationHealth),
					homeSavedViewId: selectedField(
						column(installation, "homeSavedViewId"),
						Schema.NullOr(SavedViewId),
					),
					clientApiVersion: selectedField(column(plugin, "clientApiVersion"), Schema.Literal(1)),
				},
			}),
		},
		map: ({ installations }) => Result.succeed(installations),
	}),
);

export type PluginClientCatalog = Array<PluginClientCatalogEntry>;
export type PluginClientCatalogEntry = PluginClientCatalogPage["items"][number];
export type PluginClientCatalogPage = Recipe.Success<typeof pluginClientCatalogRecipe>;
