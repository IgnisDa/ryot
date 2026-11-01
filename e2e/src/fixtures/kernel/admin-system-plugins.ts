import { PluginId, PluginPackageId, PluginRevisionId } from "@ryot-app/contract/schema/brands";
import {
	and,
	ascending,
	column,
	defineRecipe,
	eq,
	literal,
	selectedField,
	selectedRows,
	table,
} from "@ryot-app/ryotql";
import { Result, Schema } from "effect";

import type { HarnessTarget } from "~/support/harness-target";

import { collectAdminRyotQLRecipeItems } from "./ryotql";

const plugin = table("plugin", "plugin");

export const adminSystemPluginsRecipe = defineRecipe((input: { readonly after?: string }) => ({
	map: ({ plugins }) => Result.succeed(plugins),
	queries: {
		plugins: selectedRows(plugin, {
			limit: 100,
			after: input.after,
			orderBy: [ascending(column(plugin, "id"))],
			where: and(
				eq(column(plugin, "scope"), literal("system")),
				eq(column(plugin, "status"), literal("active")),
			),
			selection: {
				id: selectedField(column(plugin, "id"), PluginId),
				packageId: selectedField(column(plugin, "packageId"), PluginPackageId),
				name: selectedField(column(plugin, "name"), Schema.NullOr(Schema.String)),
				version: selectedField(column(plugin, "version"), Schema.NullOr(Schema.String)),
				contentHash: selectedField(column(plugin, "contentHash"), Schema.NullOr(Schema.String)),
				activeRevisionId: selectedField(
					column(plugin, "activeRevisionId"),
					Schema.NullOr(PluginRevisionId),
				),
			},
		}),
	},
}));

export const listAdminSystemPlugins = (target?: HarnessTarget) =>
	collectAdminRyotQLRecipeItems((after) => adminSystemPluginsRecipe({ after }), target);
