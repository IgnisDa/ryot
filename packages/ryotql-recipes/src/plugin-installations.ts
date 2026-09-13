import { PluginConfigSchema } from "@ryot-app/contract/modules/plugins/manifest";
import { PluginInstallationHealth } from "@ryot-app/contract/modules/plugins/schemas";
import { PluginSlug, SavedViewId } from "@ryot-app/contract/schema/brands";
import { JsonValue } from "@ryot-app/contract/schema/json";
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
} from "@ryot-app/ryotql";
import { Result, Schema } from "effect";

const plugin = table("plugin", "plugin");
const installation = table("pluginInstallation", "installation");

export const pluginInstallationsRecipe = defineRecipe(
	(input: { readonly after?: string; readonly limit: number }) => ({
		map: ({ installations }) => Result.succeed(installations),
		queries: {
			installations: selectedRows(installation, {
				after: input.after,
				limit: input.limit,
				joins: [join("inner", plugin, eq(column(plugin, "id"), column(installation, "pluginId")))],
				where: and(
					eq(column(plugin, "status"), literal("active")),
					isNotNull(column(plugin, "activeRevisionId")),
				),
				orderBy: [
					ascending(column(installation, "sortOrder")),
					ascending(column(plugin, "slug")),
					ascending(column(installation, "id")),
				],
				selection: {
					slug: selectedField(column(plugin, "slug"), PluginSlug),
					icon: selectedField(column(plugin, "icon"), Schema.String),
					name: selectedField(column(plugin, "name"), Schema.String),
					version: selectedField(column(plugin, "version"), Schema.String),
					sourceHash: selectedField(column(plugin, "sourceHash"), Schema.String),
					description: selectedField(column(plugin, "description"), Schema.String),
					sortOrder: selectedField(column(installation, "sortOrder"), Schema.Number),
					isDisabled: selectedField(column(installation, "isDisabled"), Schema.Boolean),
					health: selectedField(column(installation, "health"), PluginInstallationHealth),
					configSchema: selectedField(column(plugin, "configSchema"), PluginConfigSchema),
					scope: selectedField(column(plugin, "scope"), Schema.Literals(["system", "user"])),
					config: selectedField(
						column(installation, "config"),
						Schema.Record(Schema.String, JsonValue),
					),
					healthReason: selectedField(
						column(installation, "healthReason"),
						Schema.NullOr(Schema.String),
					),
					homeSavedViewId: selectedField(
						column(installation, "homeSavedViewId"),
						Schema.NullOr(SavedViewId),
					),
					configuredSecrets: selectedField(
						column(installation, "configuredSecrets"),
						Schema.Array(Schema.String),
					),
				},
			}),
		},
	}),
);

export type PluginInstallationsPage = Recipe.Success<typeof pluginInstallationsRecipe>;
