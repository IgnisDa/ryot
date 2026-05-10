import {
	IntegrationProvider,
	ListedIntegration,
} from "@ryot/contract/modules/integrations/schemas";
import { IntegrationId, PluginSlug } from "@ryot/contract/schema/brands";
import {
	and,
	ascending,
	column,
	defineRecipe,
	descending,
	eq,
	literal,
	table,
	selectedField,
	selectedOptionalRow,
	selectedRows,
	type Recipe,
} from "@ryot/ryotql";
import { Result, Schema } from "effect";

import { IsoDateString } from "./codecs";

const integration = table("integration", "integration");
const selection = {
	id: selectedField(column(integration, "id"), IntegrationId),
	lot: selectedField(column(integration, "lot"), ListedIntegration.fields.lot),
	name: selectedField(column(integration, "name"), Schema.NullOr(Schema.String)),
	provider: selectedField(column(integration, "provider"), IntegrationProvider),
	pluginSlug: selectedField(column(integration, "pluginSlug"), PluginSlug),
	createdAt: selectedField(column(integration, "createdAt"), IsoDateString),
	updatedAt: selectedField(column(integration, "updatedAt"), IsoDateString),
	isDisabled: selectedField(column(integration, "isDisabled"), Schema.Boolean),
	syncOwnership: selectedField(column(integration, "syncOwnership"), Schema.Boolean),
	minimumProgress: selectedField(column(integration, "minimumProgress"), Schema.Number),
	maximumProgress: selectedField(column(integration, "maximumProgress"), Schema.Number),
	extraSettings: selectedField(
		column(integration, "extraSettings"),
		ListedIntegration.fields.extraSettings,
	),
	lastFinishedAt: selectedField(
		column(integration, "lastFinishedAt"),
		Schema.NullOr(IsoDateString),
	),
};

export const integrationsRecipe = defineRecipe(
	(input: {
		readonly after?: string | undefined;
		readonly limit: number;
		readonly isDisabled?: boolean | undefined;
		readonly provider?: IntegrationProvider | undefined;
	}) => {
		const predicates = [
			...(input.provider === undefined
				? []
				: [eq(column(integration, "provider"), literal(input.provider))]),
			...(input.isDisabled === undefined
				? []
				: [eq(column(integration, "isDisabled"), literal(input.isDisabled))]),
		];
		return {
			queries: {
				integrations: selectedRows(integration, {
					after: input.after,
					limit: input.limit,
					selection,
					where: predicates.length > 0 ? and(...predicates) : undefined,
					orderBy: [
						descending(column(integration, "createdAt")),
						descending(column(integration, "id")),
					],
				}),
			},
			map: ({ integrations }) => Result.succeed(integrations),
		};
	},
);

export const integrationRecipe = defineRecipe((input: { readonly id: string }) => ({
	queries: {
		integration: selectedOptionalRow(integration, {
			selection,
			orderBy: [ascending(column(integration, "id"))],
			where: eq(column(integration, "id"), literal(input.id)),
		}),
	},
	map: ({ integration: item }) => Result.succeed(item),
}));

export type IntegrationList = Recipe.Success<typeof integrationsRecipe>;
export type IntegrationSummary = NonNullable<Recipe.Success<typeof integrationRecipe>>;
