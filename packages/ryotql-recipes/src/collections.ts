import { EntityId } from "@ryot-app/contract/schema/brands";
import type { Recipe } from "@ryot-app/ryotql";
import {
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

export const allCollectionsRecipe = defineRecipe(
	(input: { readonly after?: string | undefined; readonly limit?: number | undefined } = {}) => {
		const collection = table("entity", "collection");
		return {
			map: ({ collections }) => Result.succeed(collections),
			queries: {
				collections: selectedRows(collection, {
					after: input.after,
					limit: input.limit,
					orderBy: [ascending(column(collection, "name"))],
					where: eq(column(collection, "entitySchemaSlug"), literal("collection")),
					selection: {
						id: selectedField(column(collection, "id"), EntityId),
						name: selectedField(column(collection, "name"), Schema.String),
					},
				}),
			},
		};
	},
);

export type AllCollectionsResult = Recipe.Success<typeof allCollectionsRecipe>;
