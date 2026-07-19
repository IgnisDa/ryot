import {
	ascending,
	column,
	defineRecipe,
	eq,
	join,
	literal,
	table,
	selectedField,
	selectedRows,
	type Recipe,
} from "@ryot/ryotql";
import { Result, Schema } from "effect";

const plugin = table("plugin", "plugin");
const installation = table("pluginInstallation", "installation");
const collection = table("entity", "collection");
const savedView = table("savedView", "savedView");

export const navigationRecipe = defineRecipe(() => ({
	queries: {
		workspaces: selectedRows(plugin, {
			limit: 100,
			where: eq(column(plugin, "status"), literal("active")),
			orderBy: [ascending(column(plugin, "ingestedAt")), ascending(column(plugin, "slug"))],
			joins: [
				join("left", installation, eq(column(plugin, "id"), column(installation, "pluginId"))),
			],
			selection: {
				slug: selectedField(column(plugin, "slug"), Schema.String),
				name: selectedField(column(plugin, "name"), Schema.String),
				icon: selectedField(column(plugin, "icon"), Schema.String),
				sortOrder: selectedField(column(installation, "sortOrder"), Schema.NullOr(Schema.Number)),
				isDisabled: selectedField(
					column(installation, "isDisabled"),
					Schema.NullOr(Schema.Boolean),
				),
			},
		}),
		savedViews: selectedRows(savedView, {
			limit: 100,
			orderBy: [
				ascending(column(savedView, "pluginSlug")),
				ascending(column(savedView, "sortOrder")),
				ascending(column(savedView, "createdAt")),
			],
			selection: {
				slug: selectedField(column(savedView, "slug"), Schema.String),
				name: selectedField(column(savedView, "name"), Schema.String),
				icon: selectedField(column(savedView, "icon"), Schema.String),
				sortOrder: selectedField(column(savedView, "sortOrder"), Schema.Number),
				isDisabled: selectedField(column(savedView, "isDisabled"), Schema.Boolean),
				pluginSlug: selectedField(column(savedView, "pluginSlug"), Schema.NullOr(Schema.String)),
			},
		}),
		collections: selectedRows(collection, {
			limit: 100,
			orderBy: [ascending(column(collection, "name"))],
			where: eq(column(collection, "entitySchemaSlug"), literal("collection")),
			selection: {
				id: selectedField(column(collection, "id"), Schema.String),
				name: selectedField(column(collection, "name"), Schema.String),
			},
		}),
	},
	map: ({ collections, savedViews, workspaces }) =>
		Result.succeed({
			workspaces: workspaces.items.map((workspace, index) => ({
				name: workspace.name,
				slug: workspace.slug,
				icon: workspace.icon,
				sortOrder: workspace.sortOrder ?? index,
				isDisabled: workspace.isDisabled ?? false,
			})),
			savedViews: savedViews.items,
			collections: collections.items.map((item, index) => ({
				name: item.name,
				slug: item.id,
				sortOrder: index,
				icon: "layers-3",
				pluginSlug: null,
				isDisabled: false,
			})),
		}),
}));

export type NavigationData = Recipe.Success<typeof navigationRecipe>;
export type NavigationView = NavigationData["savedViews"][number];
export type NavigationWorkspace = NavigationData["workspaces"][number];
