import type { AppSavedView } from "#/features/saved-views/model";

type ViewExpression = AppSavedView["queryDefinition"]["sort"]["expression"];
type RuntimeReference = Extract<
	ViewExpression,
	{ type: "reference" }
>["reference"];

const entityField = (schemaSlug: string, field: string) => {
	return `entity.${schemaSlug}.${field}`;
};

const literalExpression = (value: unknown | null): ViewExpression => ({
	value,
	type: "literal",
});

const parseReference = (reference: string): RuntimeReference => {
	const [namespace, segment, tail, ...rest] = reference.split(".");
	if (namespace === "computed") {
		if (!segment || tail || rest.length > 0) {
			throw new Error(`Invalid saved view reference '${reference}'`);
		}

		return { type: "computed-field", key: segment };
	}

	if (namespace === "event") {
		if (!segment || !tail || rest.length > 0) {
			throw new Error(`Invalid saved view reference '${reference}'`);
		}

		return tail.startsWith("@")
			? { type: "event-join-column", joinKey: segment, column: tail.slice(1) }
			: { type: "event-join-property", joinKey: segment, property: tail };
	}

	if (namespace !== "entity" || !segment || !tail || rest.length > 0) {
		throw new Error(`Invalid saved view reference '${reference}'`);
	}

	return tail.startsWith("@")
		? { type: "entity-column", slug: segment, column: tail.slice(1) }
		: { type: "schema-property", slug: segment, property: tail };
};

const toExpression = (
	input: ViewExpression | string[] | null,
): ViewExpression => {
	if (input === null) {
		return literalExpression(null);
	}

	if (!Array.isArray(input)) {
		return input;
	}

	if (!input.length) {
		return literalExpression(null);
	}

	const values = input.map((reference) => ({
		type: "reference" as const,
		reference: parseReference(reference),
	}));

	return values.length === 1
		? (values[0] ?? literalExpression(null))
		: { type: "coalesce", values };
};

export const defaultSavedViewDisplayConfiguration: AppSavedView["displayConfiguration"] =
	{
		table: {
			columns: [
				{
					label: "Name",
					expression: toExpression([entityField("schema-1", "@name")]),
				},
			],
		},
		grid: {
			badgeProperty: literalExpression(null),
			subtitleProperty: literalExpression(null),
			titleProperty: toExpression([entityField("schema-1", "@name")]),
			imageProperty: toExpression([entityField("schema-1", "@image")]),
		},
		list: {
			badgeProperty: literalExpression(null),
			subtitleProperty: literalExpression(null),
			titleProperty: toExpression([entityField("schema-1", "@name")]),
			imageProperty: toExpression([entityField("schema-1", "@image")]),
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
		computedFields: overrides.queryDefinition?.computedFields ?? [],
		entitySchemaSlugs: overrides.queryDefinition?.entitySchemaSlugs ?? [
			"schema-1",
		],
		sort: overrides.queryDefinition?.sort ?? {
			expression: toExpression([entityField("schema-1", "@name")]),
			direction: "asc",
		},
		...(overrides.queryDefinition?.filter
			? { filter: overrides.queryDefinition.filter }
			: {}),
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
