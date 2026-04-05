import { EntityId } from "@ryot/contract/schema/brands";
import type { Recipe } from "@ryot/ryotql";
import {
	ascending,
	column,
	defineRecipe,
	eq,
	literal,
	selectedField,
	selectedRows,
	table,
} from "@ryot/ryotql";
import { Result, Schema } from "effect";

export const allCollectionsRecipe = defineRecipe(
	(
		input: {
			readonly after?: string | undefined;
			readonly limit?: number | undefined;
		} = {},
	) => {
		const collection = table("entity", "collection");
		return {
			queries: {
				collections: selectedRows(collection, {
					after: input.after,
					limit: input.limit,
					orderBy: [ascending(column(collection, "name"))],
					selection: {
						id: selectedField(column(collection, "id"), EntityId),
						name: selectedField(column(collection, "name"), Schema.String),
					},
					where: eq(column(collection, "entitySchemaSlug"), literal("collection")),
				}),
			},
			map: ({ collections }) => Result.succeed(collections),
		};
	},
);

export type AllCollectionsResult = Recipe.Success<typeof allCollectionsRecipe>;
