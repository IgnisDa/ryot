import {
	IntegrationProvider,
	IntegrationSnapshot,
} from "@ryot-app/contract/modules/integrations/schemas";
import {
	IntegrationId,
	IntegrationWebhookToken,
	PluginSlug,
} from "@ryot-app/contract/schema/brands";
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
} from "@ryot-app/ryotql";
import { Option, Result, Schema } from "effect";

import { IsoDateString } from "./codecs";

const integration = table("integration", "integration");
const selection = {
	id: selectedField(column(integration, "id"), IntegrationId),
	pluginSlug: selectedField(column(integration, "pluginSlug"), PluginSlug),
	createdAt: selectedField(column(integration, "createdAt"), IsoDateString),
	updatedAt: selectedField(column(integration, "updatedAt"), IsoDateString),
	isDisabled: selectedField(column(integration, "isDisabled"), Schema.Boolean),
	provider: selectedField(column(integration, "provider"), IntegrationProvider),
	lot: selectedField(column(integration, "lot"), IntegrationSnapshot.fields.lot),
	name: selectedField(column(integration, "name"), Schema.NullOr(Schema.String)),
	syncOwnership: selectedField(column(integration, "syncOwnership"), Schema.Boolean),
	minimumProgress: selectedField(column(integration, "minimumProgress"), Schema.Number),
	maximumProgress: selectedField(column(integration, "maximumProgress"), Schema.Number),
	lastFinishedAt: selectedField(
		column(integration, "lastFinishedAt"),
		Schema.NullOr(IsoDateString),
	),
	extraSettings: selectedField(
		column(integration, "extraSettings"),
		IntegrationSnapshot.fields.extraSettings,
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
			map: ({ integrations }) => Result.succeed(integrations),
			queries: {
				integrations: selectedRows(integration, {
					selection,
					after: input.after,
					limit: input.limit,
					where: predicates.length > 0 ? and(...predicates) : undefined,
					orderBy: [
						descending(column(integration, "createdAt")),
						descending(column(integration, "id")),
					],
				}),
			},
		};
	},
);

export const integrationRecipe = defineRecipe((input: { readonly id: string }) => ({
	map: ({ integration: item }) =>
		Result.succeed(item === undefined ? Option.none() : Option.some(item)),
	queries: {
		integration: selectedOptionalRow(integration, {
			orderBy: [ascending(column(integration, "id"))],
			where: eq(column(integration, "id"), literal(input.id)),
			selection: {
				...selection,
				webhookToken: selectedField(
					column(integration, "webhookToken"),
					Schema.NullOr(IntegrationWebhookToken),
				),
				providerSpecifics: selectedField(
					column(integration, "providerSpecifics"),
					IntegrationSnapshot.fields.providerSpecifics,
				),
			},
		}),
	},
}));

export type IntegrationList = Recipe.Success<typeof integrationsRecipe>;
export type IntegrationSummary = IntegrationList["items"][number];
export type IntegrationDetail = Recipe.Success<typeof integrationRecipe>;
