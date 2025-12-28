import type { AppSavedView } from "#/features/saved-views/model";

const entityField = (schemaSlug: string, field: string) => {
	return `entity.${schemaSlug}.${field}`;
};

export const defaultSavedViewDisplayConfiguration: AppSavedView["displayConfiguration"] =
	{
		table: {
			columns: [
				{ label: "Name", property: [entityField("schema-1", "@name")] },
			],
		},
		grid: {
			badgeProperty: null,
			subtitleProperty: null,
			titleProperty: [entityField("schema-1", "@name")],
			imageProperty: [entityField("schema-1", "@image")],
		},
		list: {
			badgeProperty: null,
			subtitleProperty: null,
			titleProperty: [entityField("schema-1", "@name")],
			imageProperty: [entityField("schema-1", "@image")],
		},
	};

type SavedViewFixtureOverrides = Omit<
	Partial<AppSavedView>,
	"queryDefinition"
> & {
	queryDefinition?: Partial<AppSavedView["queryDefinition"]>;
};

export function createSavedViewFixture(
	overrides: SavedViewFixtureOverrides = {},
): AppSavedView {
	const { queryDefinition: _queryDefinitionOverride, ...viewOverrides } =
		overrides;
	const queryDefinition = {
		eventJoins: overrides.queryDefinition?.eventJoins ?? [],
		filters: overrides.queryDefinition?.filters ?? [],
		entitySchemaSlugs: overrides.queryDefinition?.entitySchemaSlugs ?? [
			"schema-1",
		],
		sort:
			overrides.queryDefinition?.sort ??
			({
				fields: [entityField("schema-1", "@name")],
				direction: "asc",
			} as const),
	} satisfies AppSavedView["queryDefinition"];

	return {
		id: "view-1",
		sortOrder: 1,
		isBuiltin: true,
		queryDefinition,
		icon: "book-open",
		name: "All Views",
		isDisabled: false,
		trackerId: "tracker-1",
		accentColor: "#5B7FFF",
		createdAt: "2026-03-20T10:00:00.000Z",
		updatedAt: "2026-03-20T10:05:00.000Z",
		displayConfiguration: defaultSavedViewDisplayConfiguration,
		...viewOverrides,
	};
}
