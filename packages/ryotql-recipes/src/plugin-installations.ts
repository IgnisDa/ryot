import { PluginConfigSchema } from "@ryot-app/contract/modules/plugins/manifest";
import { SavedViewReference } from "@ryot-app/contract/modules/plugins/references";
import {
	PluginInstallationHealth,
	PluginInstallationIncompatibilityReason,
	PluginInstallationWriteResult,
} from "@ryot-app/contract/modules/plugins/schemas";
import {
	PluginId,
	PluginPackageId,
	PluginRevisionId,
	PluginSlug,
} from "@ryot-app/contract/schema/brands";
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
					pluginId: selectedField(column(plugin, "id"), PluginId),
					slug: selectedField(column(plugin, "slug"), PluginSlug),
					icon: selectedField(column(plugin, "icon"), Schema.String),
					name: selectedField(column(plugin, "name"), Schema.String),
					version: selectedField(column(plugin, "version"), Schema.String),
					packageId: selectedField(column(plugin, "packageId"), PluginPackageId),
					sourceHash: selectedField(column(plugin, "sourceHash"), Schema.String),
					description: selectedField(column(plugin, "description"), Schema.String),
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
					installationId: selectedField(
						column(installation, "id"),
						PluginInstallationWriteResult.fields.id,
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
	}),
);

export type PluginInstallationsPage = Recipe.Success<typeof pluginInstallationsRecipe>;
