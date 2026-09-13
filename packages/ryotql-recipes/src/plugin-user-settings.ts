import { PluginUserSettingsSchema } from "@ryot-app/contract/modules/plugins/manifest";
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

export const pluginUserSettingsRecipe = defineRecipe(
	(input: { readonly after?: string; readonly limit: number }) => ({
		map: ({ installations }) => Result.succeed(installations),
		queries: {
			installations: selectedRows(installation, {
				after: input.after,
				limit: input.limit,
				orderBy: [ascending(column(plugin, "name")), ascending(column(installation, "id"))],
				joins: [join("inner", plugin, eq(column(plugin, "id"), column(installation, "pluginId")))],
				where: and(
					eq(column(plugin, "status"), literal("active")),
					isNotNull(column(plugin, "userSettingsSchema")),
				),
				selection: {
					name: selectedField(column(plugin, "name"), Schema.String),
					icon: selectedField(column(plugin, "icon"), Schema.String),
					id: selectedField(column(installation, "id"), Schema.String),
					updatedAt: selectedField(column(installation, "updatedAt"), Schema.String),
					settingsSchema: selectedField(
						column(plugin, "userSettingsSchema"),
						PluginUserSettingsSchema,
					),
					settings: selectedField(
						column(installation, "userSettings"),
						Schema.Record(Schema.String, JsonValue),
					),
				},
			}),
		},
	}),
);

export type PluginUserSettingsPage = Recipe.Success<typeof pluginUserSettingsRecipe>;
