import { integrationCommonSchema } from "@ryot-app/contract/modules/integrations/schemas";
import { integrationLots } from "@ryot-app/contract/modules/integrations/types";
import { AppSchema } from "@ryot-app/contract/schema/property-schema";
import {
	ascending,
	column,
	defineRecipe,
	selectedField,
	selectedRows,
	table,
	type Recipe,
} from "@ryot-app/ryotql";
import { Result, Schema } from "effect";

const provider = table("integrationProvider", "provider");

export const integrationProvidersRecipe = defineRecipe(
	(input: { readonly after?: string; readonly limit: number }) => ({
		map: ({ providers }) =>
			Result.succeed({
				...providers,
				items: providers.items.map((item) => ({
					...item,
					commonSchema: integrationCommonSchema(item.lot),
				})),
			}),
		queries: {
			providers: selectedRows(provider, {
				after: input.after,
				limit: input.limit,
				orderBy: [ascending(column(provider, "name")), ascending(column(provider, "id"))],
				selection: {
					id: selectedField(column(provider, "id"), Schema.String),
					slug: selectedField(column(provider, "slug"), Schema.String),
					name: selectedField(column(provider, "name"), Schema.String),
					hasScript: selectedField(column(provider, "hasScript"), Schema.Boolean),
					pluginSlug: selectedField(column(provider, "pluginSlug"), Schema.String),
					description: selectedField(column(provider, "description"), Schema.String),
					settingsSchema: selectedField(column(provider, "settingsSchema"), AppSchema),
					requiresProKey: selectedField(column(provider, "requiresProKey"), Schema.Boolean),
					lot: selectedField(column(provider, "lot"), Schema.Literals([...integrationLots])),
				},
			}),
		},
	}),
);

export type IntegrationProvidersPage = Recipe.Success<typeof integrationProvidersRecipe>;
