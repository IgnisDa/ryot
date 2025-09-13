import { createEntityColumnExpression } from "@ryot/ts-utils";
import type { AppSavedView } from "~/features/saved-views/model";

type ViewExpression = AppSavedView["queryDefinition"]["sort"]["expression"];

const literalExpression = (value: unknown | null): ViewExpression => ({
	value,
	type: "literal",
});

const nullExpression = literalExpression(null);
const nameExpression = createEntityColumnExpression("schema-1", "name");
const imageExpression = createEntityColumnExpression("schema-1", "image");

export const defaultSavedViewDisplayConfiguration: AppSavedView["displayConfiguration"] =
	{
		table: {
			columns: [{ label: "Name", expression: nameExpression }],
		},
		grid: {
			calloutProperty: nullExpression,
			titleProperty: nameExpression,
			imageProperty: imageExpression,
			primarySubtitleProperty: nullExpression,
			secondarySubtitleProperty: nullExpression,
		},
		list: {
			calloutProperty: nullExpression,
			titleProperty: nameExpression,
			imageProperty: imageExpression,
			primarySubtitleProperty: nullExpression,
			secondarySubtitleProperty: nullExpression,
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
	const { queryDefinition: queryDefinitionOverride, ...viewOverrides } =
		overrides;
	const queryDefinition = {
		filter: queryDefinitionOverride?.filter ?? null,
		eventJoins: queryDefinitionOverride?.eventJoins ?? [],
		computedFields: queryDefinitionOverride?.computedFields ?? [],
		entitySchemaSlugs: queryDefinitionOverride?.entitySchemaSlugs ?? [
			"schema-1",
		],
		sort: queryDefinitionOverride?.sort ?? {
			direction: "asc",
			expression: nameExpression,
		},
	} satisfies AppSavedView["queryDefinition"];

	return {
		id: "view-1",
		sortOrder: 1,
		slug: "view-1",
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
