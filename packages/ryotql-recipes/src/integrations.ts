import {
	IntegrationProvider,
	IntegrationSnapshot,
} from "@ryot-app/contract/modules/integrations/schemas";
import { IntegrationId, IntegrationWebhookToken, PluginId } from "@ryot-app/contract/schema/brands";
import {
	and,
	ascending,
	column,
	defineRecipe,
	descending,
	eq,
	type Recipe,
	selectedField,
	selectedOptionalRow,
	selectedRows,
	table,
} from "@ryot-app/ryotql";
import { parameters } from "@ryot-app/ryotql/authoring";
import { Option, Result, Schema } from "effect";

import { IsoDateString } from "./codecs";

const integration = table("integration", "integration");
const selection = {
	id: selectedField(column(integration, "id"), IntegrationId),
	createdAt: selectedField(column(integration, "createdAt"), IsoDateString),
	updatedAt: selectedField(column(integration, "updatedAt"), IsoDateString),
	isDisabled: selectedField(column(integration, "isDisabled"), Schema.Boolean),
	provider: selectedField(column(integration, "provider"), IntegrationProvider),
	lot: selectedField(column(integration, "lot"), IntegrationSnapshot.fields.lot),
	name: selectedField(column(integration, "name"), Schema.NullOr(Schema.String)),
	pluginId: selectedField(column(integration, "pluginId"), Schema.NullOr(PluginId)),
	syncOwnership: selectedField(column(integration, "syncOwnership"), Schema.Boolean),
	minimumProgress: selectedField(column(integration, "minimumProgress"), Schema.Finite),
	maximumProgress: selectedField(column(integration, "maximumProgress"), Schema.Finite),
	lastFinishedAt: selectedField(
		column(integration, "lastFinishedAt"),
		Schema.NullOr(IsoDateString),
	),
	extraSettings: selectedField(
		column(integration, "extraSettings"),
		IntegrationSnapshot.fields.extraSettings,
	),
};

export const integrationsRecipe = (() => {
	const recipeParameters = parameters({
		fields: {
			provider: { type: "string", label: "provider", description: "Query provider" },
			isDisabled: { type: "boolean", label: "isDisabled", description: "Query isDisabled" },
		},
	});

	const predicates = [
		recipeParameters.whenSet(
			"provider",
			eq(column(integration, "provider"), recipeParameters.value("provider")),
		),
		recipeParameters.whenSet(
			"isDisabled",
			eq(column(integration, "isDisabled"), recipeParameters.value("isDisabled")),
		),
	];
	return defineRecipe({
		parameters: recipeParameters.schema,
		map: ({ integrations }) => Result.succeed(integrations),
		queries: {
			integrations: selectedRows(integration, {
				selection,

				limit: 20,
				maxLimit: 1000,
				where: predicates.length > 0 ? and(...predicates) : undefined,
				orderBy: [
					descending(column(integration, "createdAt")),
					descending(column(integration, "id")),
				],
			}),
		},
	});
})();

export const integrationRecipe = (() => {
	const recipeParameters = parameters({
		fields: {
			id: {
				label: "id",
				type: "string",
				description: "Query argument",
				validation: { required: true },
			},
		},
	});
	return defineRecipe({
		parameters: recipeParameters.schema,
		map: ({ integration: item }) =>
			Result.succeed(item === undefined ? Option.none() : Option.some(item)),
		queries: {
			integration: selectedOptionalRow(integration, {
				orderBy: [ascending(column(integration, "id"))],
				where: eq(column(integration, "id"), recipeParameters.value("id")),
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
	});
})();

export type IntegrationSummary = IntegrationList["items"][number];
export type IntegrationList = Recipe.Success<typeof integrationsRecipe>;
export type IntegrationDetail = Recipe.Success<typeof integrationRecipe>;
