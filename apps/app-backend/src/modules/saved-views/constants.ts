import type { DisplayConfiguration, SavedViewQueryDefinition } from "./schemas";

export const defaultDisplayConfiguration: DisplayConfiguration = {
	layout: "grid",
	table: { columns: [{ property: ["@name"] }] },
	grid: {
		badgeProperty: null,
		subtitleProperty: null,
		titleProperty: ["@name"],
		imageProperty: ["@image"],
	},
	list: {
		badgeProperty: null,
		subtitleProperty: null,
		titleProperty: ["@name"],
		imageProperty: ["@image"],
	},
};

export const createDefaultQueryDefinition = (
	entitySchemaSlugs: string[],
): SavedViewQueryDefinition => ({
	filters: [],
	entitySchemaSlugs,
	sort: { field: ["@name"], direction: "asc" },
});
