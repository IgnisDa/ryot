import {
	ascending,
	castText,
	column,
	document,
	eq,
	field,
	join,
	jsonPath,
	literal,
	rows,
	table,
} from "@ryot/ryotql";

export const buildNavigationDocument = () => {
	const plugin = table("plugin", "plugin");
	const state = table("pluginState", "state");
	const savedView = table("savedView", "savedView");
	const collection = table("entity", "collection");
	const metadata = jsonPath(column(plugin, "manifest"), "metadata");

	return document({
		workspaces: rows(plugin, {
			limit: 100,
			joins: [join("left", state, eq(column(plugin, "slug"), column(state, "pluginSlug")))],
			where: eq(column(plugin, "status"), literal("active")),
			orderBy: [ascending(column(plugin, "ingestedAt")), ascending(column(plugin, "slug"))],
			fields: [
				field("slug", column(plugin, "slug")),
				field("name", castText(jsonPath(metadata, "name"))),
				field("icon", castText(jsonPath(metadata, "icon"))),
				field("accentColor", castText(jsonPath(metadata, "accentColor"))),
				field("sortOrder", column(state, "sortOrder")),
				field("isDisabled", column(state, "isDisabled")),
			],
		}),
		savedViews: rows(savedView, {
			limit: 100,
			orderBy: [
				ascending(column(savedView, "pluginSlug")),
				ascending(column(savedView, "sortOrder")),
				ascending(column(savedView, "createdAt")),
			],
			fields: [
				field("slug", column(savedView, "slug")),
				field("name", column(savedView, "name")),
				field("icon", column(savedView, "icon")),
				field("accentColor", column(savedView, "accentColor")),
				field("sortOrder", column(savedView, "sortOrder")),
				field("isDisabled", column(savedView, "isDisabled")),
				field("pluginSlug", column(savedView, "pluginSlug")),
			],
		}),
		collections: rows(collection, {
			limit: 100,
			orderBy: [ascending(column(collection, "name"))],
			where: eq(column(collection, "entitySchemaSlug"), literal("collection")),
			fields: [field("id", column(collection, "id")), field("name", column(collection, "name"))],
		}),
	});
};
