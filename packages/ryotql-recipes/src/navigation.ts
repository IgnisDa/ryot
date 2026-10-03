import {
	ascending,
	column,
	defineRecipe,
	eq,
	literal,
	table,
	selectedField,
	selectedRows,
	type Recipe,
} from "@ryot-app/ryotql";
import { Result, Schema } from "effect";

const collection = table("entity", "collection");
const savedView = table("savedView", "savedView");

export const navigationRecipe = defineRecipe(() => ({
	map: ({ savedViews, collections }) =>
		Result.succeed({
			savedViews: savedViews.items,
			collections: collections.items.map((item, index) => ({
				slug: item.id,
				name: item.name,
				isHidden: false,
				sortOrder: index,
				icon: "layers-3",
				pluginSlug: null,
			})),
		}),
	queries: {
		collections: selectedRows(collection, {
			limit: 100,
			orderBy: [ascending(column(collection, "name"))],
			where: eq(column(collection, "entitySchemaSlug"), literal("collection")),
			selection: {
				id: selectedField(column(collection, "id"), Schema.String),
				name: selectedField(column(collection, "name"), Schema.String),
			},
		}),
		savedViews: selectedRows(savedView, {
			limit: 100,
			orderBy: [
				ascending(column(savedView, "pluginSlug")),
				ascending(column(savedView, "sortOrder")),
				ascending(column(savedView, "slug")),
			],
			selection: {
				slug: selectedField(column(savedView, "slug"), Schema.String),
				name: selectedField(column(savedView, "name"), Schema.String),
				icon: selectedField(column(savedView, "icon"), Schema.String),
				isHidden: selectedField(column(savedView, "isHidden"), Schema.Boolean),
				sortOrder: selectedField(column(savedView, "sortOrder"), Schema.Finite),
				pluginSlug: selectedField(column(savedView, "pluginSlug"), Schema.NullOr(Schema.String)),
			},
		}),
	},
}));

export type NavigationData = Recipe.Success<typeof navigationRecipe>;
export type NavigationView = NavigationData["savedViews"][number];
