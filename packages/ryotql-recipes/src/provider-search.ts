import {
	type EntitySchemaReference,
	ownerIdentityReference,
} from "@ryot-app/contract/modules/plugins/references";
import { EntitySchemaSlug, SandboxProviderId } from "@ryot-app/contract/schema/brands";
import { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { Message } from "@ryot-app/i18n/message";
import type { Recipe } from "@ryot-app/ryotql";
import {
	and,
	ascending,
	column,
	defineRecipe,
	eq,
	join,
	literal,
	schemaOwnerPredicate,
	selectedField,
	selectedRows,
	table,
} from "@ryot-app/ryotql";
import { Result, Schema } from "effect";

export const providerSearchRecipe = (input: { readonly schema: EntitySchemaReference }) => {
	const provider = table("sandboxProvider", "provider");
	const operation = table("sandboxProviderOperation", "operation");
	const plugin = table("plugin", "plugin");

	return defineRecipe({
		map: ({ providers }) => Result.succeed(providers),
		queries: {
			providers: selectedRows(provider, {
				limit: 100,
				orderBy: [ascending(column(provider, "slug")), ascending(column(provider, "id"))],
				joins: [
					join("inner", operation, eq(column(provider, "id"), column(operation, "providerId"))),
					join("inner", plugin, eq(column(provider, "pluginId"), column(plugin, "id"))),
				],
				where: and(
					eq(column(provider, "rootEntitySchemaSlug"), literal(input.schema.slug)),
					schemaOwnerPredicate(provider, "pluginId", ownerIdentityReference(input.schema.owner)),
					eq(column(operation, "operation"), literal("search")),
					eq(column(plugin, "status"), literal("active")),
				),
				selection: {
					providerName: selectedField(column(provider, "name"), Message),
					providerId: selectedField(column(provider, "id"), SandboxProviderId),
					providerSlug: selectedField(column(provider, "slug"), Schema.String),
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
	});
};

export type ProviderSearchResult = Recipe.Success<ReturnType<typeof providerSearchRecipe>>;
