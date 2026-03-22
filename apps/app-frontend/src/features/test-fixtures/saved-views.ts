import type { AppSavedView } from "#/features/saved-views/model";

export const defaultSavedViewDisplayConfiguration: AppSavedView["displayConfiguration"] =
	{
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

export function createSavedViewFixture(
	overrides: Partial<AppSavedView> = {},
): AppSavedView {
	return {
		id: "view-1",
		sortOrder: 1,
		isBuiltin: true,
		icon: "book-open",
		name: "All Views",
		isDisabled: false,
		trackerId: "tracker-1",
		accentColor: "#5B7FFF",
		createdAt: "2026-03-20T10:00:00.000Z",
		updatedAt: "2026-03-20T10:05:00.000Z",
		displayConfiguration: defaultSavedViewDisplayConfiguration,
		queryDefinition: {
			filters: [],
			entitySchemaSlugs: ["schema-1"],
			sort: { fields: ["@name"], direction: "asc" },
		},
		...overrides,
	};
}
