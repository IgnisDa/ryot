import type { PluginIdentityReference } from "@ryot-app/plugin-client-sdk/plugin";
import { createRyotQuery } from "@ryot-app/plugin-client-sdk/react";
import type { Recipe } from "@ryot-app/plugin-client-sdk/ryotql";

import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import type { mediaEntityParameters } from "../../shared/query-parameters";

export type MediaEntityRecipe<Data> = (input: {
	readonly reference: PluginIdentityReference;
}) => Recipe<Data, typeof mediaEntityParameters.schema>;

type EntityInput = { readonly entityId: string };

/** A detail query whose foreground is the entity and whose loaded result names the visible entities. */
export const createMediaEntityQuery = <Data>(
	recipe: MediaEntityRecipe<Data>,
	visible: (data: Data) => readonly string[],
) =>
	createRyotQuery<EntityInput, Data>(
		({ input, client }) =>
			client.data.query(recipe({ reference: client.pluginIdentity(PLUGIN_PACKAGE_ID) }), input),
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
	summaryRecipe: MediaEntityRecipe<Data>,
	summaryVisible: (summary: NonNullable<Data["summary"]>) => readonly string[] = () => [],
) =>
	createMediaEntityQuery(summaryRecipe, (data) =>
		data.summary === null
			? []
			: [...data.summary.collections.items.map(({ id }) => id), ...summaryVisible(data.summary)],
	);
