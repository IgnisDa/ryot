import type { PluginIdentityReference } from "@ryot-app/plugin-client-sdk/plugin";
import { createRyotQuery } from "@ryot-app/plugin-client-sdk/react";
import type { PreparedRecipe } from "@ryot-app/plugin-client-sdk/ryotql";

import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";

const SUMMARY_COLLECTION_LIMIT = 6;

type EntityInput = { readonly entityId: string };
type EntityRecipeInput = EntityInput & { readonly reference: PluginIdentityReference };

/** A detail query whose foreground is the entity and whose loaded result names the visible entities. */
export const createMediaEntityQuery = <Data>(
	recipe: (input: EntityRecipeInput) => PreparedRecipe<Data>,
	visible: (data: Data) => readonly string[],
) =>
	createRyotQuery<EntityInput, Data>(
		({ input, client }) =>
			client.data.query(recipe({ ...input, reference: client.pluginIdentity(PLUGIN_PACKAGE_ID) })),
		{
			entityWatch: ({ data, input }) => ({
				foreground: [input.entityId],
				visible: data === undefined ? [] : visible(data),
			}),
		},
	);

type SummaryVisible = {
	readonly collections: { readonly items: readonly { readonly id: string }[] };
};

export const createMediaSummaryQuery = <Data extends { readonly summary: null | SummaryVisible }>(
	summaryRecipe: (input: {
		readonly entityId: string;
		readonly collectionLimit: number;
		readonly reference: PluginIdentityReference;
	}) => PreparedRecipe<Data>,
	summaryVisible: (summary: NonNullable<Data["summary"]>) => readonly string[] = () => [],
) =>
	createMediaEntityQuery(
		(input) => summaryRecipe({ ...input, collectionLimit: SUMMARY_COLLECTION_LIMIT }),
		(data) =>
			data.summary === null
				? []
				: [...data.summary.collections.items.map(({ id }) => id), ...summaryVisible(data.summary)],
	);
