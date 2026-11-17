import { PluginConfigSchema } from "@ryot-app/contract/modules/plugins/manifest";
import { stampAppSchema } from "@ryot-app/contract/modules/plugins/manifest-text";
import { SavedViewReference } from "@ryot-app/contract/modules/plugins/references";
import {
	PluginInstallationHealth,
	PluginInstallationIncompatibilityReason,
} from "@ryot-app/contract/modules/plugins/schemas";
import { PluginId, PluginPackageId, PluginRevisionId } from "@ryot-app/contract/schema/brands";
import { JsonValue } from "@ryot-app/contract/schema/json";
import { Message } from "@ryot-app/i18n/message";
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

export const pluginInstallationsRecipe = defineRecipe({
	map: ({ installations }) =>
		Result.succeed({
			...installations,
			items: installations.items.map((item) => ({
				...item,
				configSchema: stampAppSchema(item.pluginId, item.configSchema),
			})),
		}),
	queries: {
		installations: selectedRows(installation, {
			limit: 20,
			maxLimit: 1000,
			joins: [join("inner", plugin, eq(column(plugin, "id"), column(installation, "pluginId")))],
			where: and(
				eq(column(plugin, "status"), literal("active")),
				isNotNull(column(plugin, "activeRevisionId")),
			),
			orderBy: [
				ascending(column(installation, "sortOrder")),
				ascending(column(plugin, "packageId")),
				ascending(column(installation, "id")),
			],
			selection: {
				name: selectedField(column(plugin, "name"), Message),
				pluginId: selectedField(column(plugin, "id"), PluginId),
				icon: selectedField(column(plugin, "icon"), Schema.String),
				version: selectedField(column(plugin, "version"), Schema.String),
				description: selectedField(column(plugin, "description"), Message),
				packageId: selectedField(column(plugin, "packageId"), PluginPackageId),
				contentHash: selectedField(column(plugin, "contentHash"), Schema.String),
				installationId: selectedField(column(installation, "id"), Schema.String),
				isHidden: selectedField(column(installation, "isHidden"), Schema.Boolean),
				sortOrder: selectedField(column(installation, "sortOrder"), Schema.Finite),
				activationId: selectedField(column(plugin, "activationId"), Schema.String),
				health: selectedField(column(installation, "health"), PluginInstallationHealth),
				configSchema: selectedField(column(plugin, "configSchema"), PluginConfigSchema),
				scope: selectedField(column(plugin, "scope"), Schema.Literals(["system", "user"])),
				isInitialized: selectedField(column(installation, "isInitialized"), Schema.Boolean),
				activeRevisionId: selectedField(column(plugin, "activeRevisionId"), PluginRevisionId),
				config: selectedField(
					column(installation, "config"),
					Schema.Record(Schema.String, JsonValue),
				),
				healthReason: selectedField(
					column(installation, "healthReason"),
					Schema.NullOr(Schema.String),
				),
				homeSavedView: selectedField(
					column(installation, "homeSavedView"),
					Schema.NullOr(SavedViewReference),
				),
				configuredSecrets: selectedField(
					column(installation, "configuredSecrets"),
					Schema.Array(Schema.String),
				),
				incompatibilityReason: selectedField(
					column(installation, "incompatibilityReason"),
					Schema.NullOr(PluginInstallationIncompatibilityReason),
				),
			},
		}),
	},
});

export type PluginInstallationsPage = Recipe.Success<typeof pluginInstallationsRecipe>;
