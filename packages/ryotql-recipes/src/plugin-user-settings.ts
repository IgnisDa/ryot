import { PluginUserSettingsSchema } from "@ryot-app/contract/modules/plugins/manifest";
import { stampAppSchema } from "@ryot-app/contract/modules/plugins/manifest-text";
import { PluginId } from "@ryot-app/contract/schema/brands";
import { JsonValue } from "@ryot-app/contract/schema/json";
import { Message } from "@ryot-app/i18n/message";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
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
	selectedOptionalRow,
	selectedRows,
	table,
} from "@ryot-app/ryotql";
import { parameters } from "@ryot-app/ryotql/authoring";
import { Result, Schema } from "effect";

const plugin = table("plugin", "plugin");
const installation = table("pluginInstallation", "installation");

export const pluginUserSettingsRecipe = defineRecipe({
	map: ({ installations }) =>
		Result.succeed({
			...installations,
			items: installations.items.map(({ pluginId, ...item }) => ({
				...item,
				settingsSchema: stampAppSchema(pluginId, item.settingsSchema),
			})),
		}),
	queries: {
		installations: selectedRows(installation, {
			limit: 20,
			maxLimit: 1000,
			orderBy: [ascending(column(plugin, "packageId")), ascending(column(installation, "id"))],
			joins: [join("inner", plugin, eq(column(plugin, "id"), column(installation, "pluginId")))],
			where: and(
				eq(column(plugin, "status"), literal("active")),
				isNotNull(column(plugin, "userSettingsSchema")),
			),
			selection: {
				name: selectedField(column(plugin, "name"), Message),
				pluginId: selectedField(column(plugin, "id"), PluginId),
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
});

export type PluginUserSettingsPage = Recipe.Success<typeof pluginUserSettingsRecipe>;

export const pluginInstallationUserSettingsRecipe = (() => {
	const recipeParameters = parameters({
		fields: {
			pluginId: {
				type: "string",
				description: "Query argument",
				validation: { required: true },
				label: kernelMessage("recipe.parameter.plugin"),
			},
		},
	});
	return defineRecipe({
		parameters: recipeParameters.schema,
		map: ({ installation: row }) =>
			Result.succeed(
				row === undefined
					? undefined
					: {
							id: row.id,
							settings: row.settings,
							settingsSchema:
								row.settingsSchema === null
									? null
									: stampAppSchema(row.pluginId, row.settingsSchema),
						},
			),
		queries: {
			installation: selectedOptionalRow(installation, {
				orderBy: [ascending(column(installation, "id"))],
				joins: [join("inner", plugin, eq(column(plugin, "id"), column(installation, "pluginId")))],
				where: and(
					eq(column(installation, "pluginId"), recipeParameters.value("pluginId")),
					eq(column(plugin, "status"), literal("active")),
				),
				selection: {
					pluginId: selectedField(column(plugin, "id"), PluginId),
					id: selectedField(column(installation, "id"), Schema.String),
					settings: selectedField(
						column(installation, "userSettings"),
						Schema.Record(Schema.String, JsonValue),
					),
					settingsSchema: selectedField(
						column(plugin, "userSettingsSchema"),
						Schema.NullOr(PluginUserSettingsSchema),
					),
				},
			}),
		},
	});
})();
