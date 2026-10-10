import { EntitySchemaSlug, SandboxProviderId } from "@ryot-app/contract/schema/brands";
import { AppSchema } from "@ryot-app/contract/schema/property-schema";
import type { Recipe } from "@ryot-app/ryotql";
import {
	and,
	ascending,
	column,
	defineRecipe,
	eq,
	join,
	literal,
	selectedField,
	selectedRows,
	table,
} from "@ryot-app/ryotql";
import { Result, Schema } from "effect";

export const providerSearchRecipe = defineRecipe(
	(input: {
		readonly ownerPluginId?: string | undefined;
		readonly rootEntitySchemaSlug: EntitySchemaSlug;
	}) => {
		const provider = table("sandboxProvider", "provider");
		const operation = table("sandboxProviderOperation", "operation");
		const plugin = table("plugin", "plugin");

		return {
			map: ({ providers }) => Result.succeed(providers),
			queries: {
				providers: selectedRows(provider, {
					limit: 100,
					orderBy: [
						ascending(column(provider, "name")),
						ascending(column(provider, "slug")),
						ascending(column(provider, "id")),
					],
					joins: [
						join("inner", operation, eq(column(provider, "id"), column(operation, "providerId"))),
						join("inner", plugin, eq(column(provider, "pluginId"), column(plugin, "id"))),
					],
					where: and(
						eq(column(provider, "rootEntitySchemaSlug"), literal(input.rootEntitySchemaSlug)),
						...(input.ownerPluginId === undefined
							? []
							: [eq(column(provider, "pluginId"), literal(input.ownerPluginId))]),
						eq(column(operation, "operation"), literal("search")),
						eq(column(plugin, "status"), literal("active")),
					),
					selection: {
						providerId: selectedField(column(provider, "id"), SandboxProviderId),
						providerSlug: selectedField(column(provider, "slug"), Schema.String),
						providerName: selectedField(column(provider, "name"), Schema.String),
						rootEntitySchemaSlug: selectedField(
							column(provider, "rootEntitySchemaSlug"),
							EntitySchemaSlug,
						),
						searchOptionsSchema: selectedField(
							column(operation, "optionsSchema"),
							Schema.NullOr(AppSchema),
						),
					},
				}),
			},
		};
	},
);

export type ProviderSearchResult = Recipe.Success<typeof providerSearchRecipe>;
