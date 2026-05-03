import { createEntityColumnExpression } from "@ryot/ts-utils";
import type {
	AppEntitySavedView,
	AppSavedView,
} from "~/features/saved-views/model";

type ViewExpression =
	AppEntitySavedView["queryDefinition"]["sort"]["expression"];

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
	queryDefinition?: Partial<AppEntitySavedView["queryDefinition"]>;
};

export function createSavedViewFixture(
	overrides: SavedViewFixtureOverrides = {},
): AppSavedView {
	const { queryDefinition: queryDefinitionOverride, ...viewOverrides } =
		overrides;
	const queryDefinition = {
		mode: "entities",
		filter: queryDefinitionOverride?.filter ?? null,
		eventJoins: queryDefinitionOverride?.eventJoins ?? [],
		relationships: queryDefinitionOverride?.relationships ?? [],
		computedFields: queryDefinitionOverride?.computedFields ?? [],
		scope: queryDefinitionOverride?.scope ?? ["schema-1"],
		sort: queryDefinitionOverride?.sort ?? {
			direction: "asc",
			expression: nameExpression,
		},
	} satisfies AppEntitySavedView["queryDefinition"];

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

export function createEntitySavedViewFixture(
	overrides: SavedViewFixtureOverrides = {},
): AppEntitySavedView {
	return createSavedViewFixture(overrides) as AppEntitySavedView;
}
