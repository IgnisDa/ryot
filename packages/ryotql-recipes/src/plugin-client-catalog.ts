import { PluginClientCapability } from "@ryot/contract/modules/plugins/client";
import { PluginInstallationHealth } from "@ryot/contract/modules/plugins/schemas";
import {
	ascending,
	column,
	defineRecipe,
	eq,
	join,
	selectedField,
	selectedRows,
	table,
	type Recipe,
} from "@ryot/ryotql";
import { Result, Schema } from "effect";

const plugin = table("plugin", "plugin");
const installation = table("pluginInstallation", "installation");

export const pluginClientCatalogRecipe = defineRecipe(() => ({
	queries: {
		installations: selectedRows(installation, {
			limit: 100,
			orderBy: [ascending(column(plugin, "slug"))],
			joins: [join("inner", plugin, eq(column(plugin, "id"), column(installation, "pluginId")))],
			selection: {
				slug: selectedField(column(plugin, "slug"), Schema.String),
				pluginId: selectedField(column(plugin, "id"), Schema.String),
				sourceHash: selectedField(column(plugin, "sourceHash"), Schema.String),
				installationId: selectedField(column(installation, "id"), Schema.String),
				isDisabled: selectedField(column(installation, "isDisabled"), Schema.Boolean),
				health: selectedField(column(installation, "health"), PluginInstallationHealth),
				clientArtifactHash: selectedField(
					column(plugin, "clientArtifactHash"),
					Schema.NullOr(Schema.String),
				),
				clientApiVersion: selectedField(
					column(plugin, "clientApiVersion"),
					Schema.NullOr(Schema.Number),
				),
				clientCapabilities: selectedField(
					column(plugin, "clientCapabilities"),
					Schema.NullOr(Schema.Array(PluginClientCapability)),
				),
			},
		}),
	},
	map: ({ installations }) => Result.succeed(installations.items),
}));

export type PluginClientCatalog = Recipe.Success<typeof pluginClientCatalogRecipe>;
export type PluginClientCatalogEntry = PluginClientCatalog[number];
