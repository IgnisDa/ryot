import { PluginClientEntities } from "@ryot-app/contract/modules/plugins/manifest";
import {
	PluginPackageReference,
	SavedViewReference,
} from "@ryot-app/contract/modules/plugins/references";
import { PluginInstallationHealth } from "@ryot-app/contract/modules/plugins/schemas";
import { PluginId, PluginPackageId } from "@ryot-app/contract/schema/brands";
import {
	and,
	ascending,
	column,
	defineRecipe,
	eq,
	isNotNull,
	join,
	literal,
	type Recipe,
	selectedField,
	selectedRows,
	table,
} from "@ryot-app/ryotql";
import { Result, Schema } from "effect";

const plugin = table("plugin", "plugin");
const installation = table("pluginInstallation", "installation");

export const pluginClientCatalogRecipe = defineRecipe(
	(input: { readonly after?: string | undefined } = {}) => ({
		map: ({ installations }) => Result.succeed(installations),
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
					ascending(column(plugin, "packageId")),
					ascending(column(installation, "id")),
				],
				selection: {
					pluginId: selectedField(column(plugin, "id"), PluginId),
					name: selectedField(column(plugin, "name"), Schema.String),
					icon: selectedField(column(plugin, "icon"), Schema.String),
					packageId: selectedField(column(plugin, "packageId"), PluginPackageId),
					contentHash: selectedField(column(plugin, "contentHash"), Schema.String),
					installationId: selectedField(column(installation, "id"), Schema.String),
					isHidden: selectedField(column(installation, "isHidden"), Schema.Boolean),
					sortOrder: selectedField(column(installation, "sortOrder"), Schema.Finite),
					health: selectedField(column(installation, "health"), PluginInstallationHealth),
					scope: selectedField(column(plugin, "scope"), PluginPackageReference.fields.scope),
					clientApiVersion: selectedField(column(plugin, "clientApiVersion"), Schema.Literal(1)),
					clientEntities: selectedField(
						column(plugin, "clientEntities"),
						Schema.NullOr(PluginClientEntities),
					),
					homeSavedView: selectedField(
						column(installation, "homeSavedView"),
						Schema.NullOr(SavedViewReference),
					),
				},
			}),
		},
	}),
);

export type PluginClientCatalog = Array<PluginClientCatalogEntry>;
export type PluginClientCatalogEntry = PluginClientCatalogPage["items"][number];
export type PluginClientCatalogPage = Recipe.Success<typeof pluginClientCatalogRecipe>;
