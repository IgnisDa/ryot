import type { DisplayConfiguration, SavedViewQueryDefinition } from "./schemas";

export const defaultDisplayConfiguration: DisplayConfiguration = {
	table: { columns: [{ label: "Name", property: ["@name"] }] },
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
