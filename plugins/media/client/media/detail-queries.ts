import { createRyotQuery } from "@ryot-app/client-sdk/react";
import type { PreparedRecipe } from "@ryot-app/client-sdk/ryotql";

const SUMMARY_COLLECTION_LIMIT = 6;

type EntityInput = { readonly entityId: string };

/** A detail query whose foreground is the entity and whose loaded result names the visible entities. */
export const createMediaEntityQuery = <Data>(
	recipe: (input: EntityInput) => PreparedRecipe<Data>,
	visible: (data: Data) => readonly string[],
) =>
	createRyotQuery<EntityInput, Data>(
		({ input, client, signal }) => client.data.query(recipe(input), { signal }),
		{
			entityInterest: ({ data, input }) => ({
				foreground: [input.entityId],
				visible: data === undefined ? [] : visible(data),
			}),
		},
	);

export const createMediaSummaryQuery = <
	Data extends {
		readonly summary: {
			readonly collections: { readonly items: readonly { readonly id: string }[] };
		} | null;
	},
>(
	summaryRecipe: (input: {
		readonly entityId: string;
		readonly collectionLimit: number;
	}) => PreparedRecipe<Data>,
) =>
	createMediaEntityQuery(
		(input) => summaryRecipe({ ...input, collectionLimit: SUMMARY_COLLECTION_LIMIT }),
		(data) => data.summary?.collections.items.map(({ id }) => id) ?? [],
	);
