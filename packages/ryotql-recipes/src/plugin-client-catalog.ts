import { PluginInstallationHealth } from "@ryot/contract/modules/plugins/schemas";
import {
	ascending,
	column,
	defineRecipe,
	eq,
	join,
	literal,
	selectedField,
	selectedRows,
	table,
	type Recipe,
} from "@ryot/ryotql";
import { Result, Schema } from "effect";

const plugin = table("plugin", "plugin");
const installation = table("pluginInstallation", "installation");

export const pluginClientCatalogRecipe = defineRecipe(
	(input: { readonly after?: string | undefined } = {}) => ({
		queries: {
			installations: selectedRows(installation, {
				limit: 100,
				after: input.after,
				where: eq(column(plugin, "status"), literal("active")),
				joins: [join("inner", plugin, eq(column(plugin, "id"), column(installation, "pluginId")))],
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
					clientArtifactHash: selectedField(
						column(plugin, "clientArtifactHash"),
						Schema.NullOr(Schema.String),
					),
					clientApiVersion: selectedField(
						column(plugin, "clientApiVersion"),
						Schema.NullOr(Schema.Number),
					),
				},
			}),
		},
		map: ({ installations }) => Result.succeed(installations),
	}),
);

export type PluginClientCatalog = Array<PluginClientCatalogEntry>;
export type PluginClientCatalogEntry = PluginClientCatalogPage["items"][number];
export type PluginClientCatalogPage = Recipe.Success<typeof pluginClientCatalogRecipe>;
