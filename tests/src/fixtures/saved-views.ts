import type { paths } from "@ryot/generated/openapi/app-backend";
import type { Client } from "./auth";

type CreateSavedViewBody = NonNullable<
	paths["/saved-views"]["post"]["requestBody"]
>["content"]["application/json"];
type UpdateSavedViewBody = NonNullable<
	paths["/saved-views/{viewId}"]["put"]["requestBody"]
>["content"]["application/json"];
type ReorderSavedViewsBody = NonNullable<
	paths["/saved-views/reorder"]["post"]["requestBody"]
>["content"]["application/json"];

type RuntimeRef =
	| { type: "entity-column"; slug: string; column: string }
	| { type: "schema-property"; slug: string; property: string }
	| { type: "computed-field"; key: string }
	| { type: "event-join-column"; joinKey: string; column: string }
	| { type: "event-join-property"; joinKey: string; property: string };

type ViewExpression =
	| { type: "literal"; value: unknown | null }
	| { type: "reference"; reference: RuntimeRef }
	| { type: "coalesce"; values: ViewExpression[] };

type ExpressionInput = ViewExpression | string[];

type CreateSavedViewInput = Partial<
	Omit<CreateSavedViewBody, "displayConfiguration">
> & {
	displayConfiguration?: DisplayConfigurationInput;
};

type UpdateSavedViewInput = Partial<
	Omit<UpdateSavedViewBody, "displayConfiguration">
> & {
	displayConfiguration?: DisplayConfigurationInput;
};

type DisplayConfigurationInput = {
	table: {
		columns: Array<{
			label: string;
			property?: string[];
			expression?: ExpressionInput;
		}>;
	};
	grid: {
		badgeProperty: ExpressionInput | null;
		titleProperty: ExpressionInput | null;
		imageProperty: ExpressionInput | null;
		subtitleProperty: ExpressionInput | null;
	};
	list: {
		badgeProperty: ExpressionInput | null;
		titleProperty: ExpressionInput | null;
		imageProperty: ExpressionInput | null;
		subtitleProperty: ExpressionInput | null;
	};
};

const entityField = (schemaSlug: string, property: string) => {
	if (
		property === "name" ||
		property === "image" ||
		property === "createdAt" ||
		property === "updatedAt" ||
		property.startsWith("@")
	) {
		return `entity.${schemaSlug}.${property.startsWith("@") ? property : `@${property}`}`;
	}

	return `entity.${schemaSlug}.${property}`;
};

const literalExpression = (value: unknown | null): ViewExpression => ({
	type: "literal",
	value,
});

const parseReference = (reference: string): RuntimeRef => {
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

const toExpression = (input: ExpressionInput | null): ViewExpression | null => {
	if (input === null) {
		return null;
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

const normalizeDisplayConfiguration = (
	input: DisplayConfigurationInput,
): CreateSavedViewBody["displayConfiguration"] =>
	({
		grid: {
			badgeProperty: toExpression(input.grid.badgeProperty),
			titleProperty: toExpression(input.grid.titleProperty),
			imageProperty: toExpression(input.grid.imageProperty),
			subtitleProperty: toExpression(input.grid.subtitleProperty),
		},
		list: {
			badgeProperty: toExpression(input.list.badgeProperty),
			titleProperty: toExpression(input.list.titleProperty),
			imageProperty: toExpression(input.list.imageProperty),
			subtitleProperty: toExpression(input.list.subtitleProperty),
		},
		table: {
			columns: input.table.columns.map((column) => ({
				label: column.label,
				expression:
					toExpression(column.expression ?? column.property ?? []) ??
					literalExpression(null),
			})),
		},
	}) as unknown as CreateSavedViewBody["displayConfiguration"];

const defaultQueryDefinition = {
	filters: [],
	eventJoins: [],
	computedFields: [],
	entitySchemaSlugs: ["book"],
	sort: { fields: [entityField("book", "name")], direction: "asc" },
} as CreateSavedViewBody["queryDefinition"];

const defaultDisplayConfiguration = {
	table: {
		columns: [{ label: "Name", expression: [entityField("book", "name")] }],
	},
	grid: {
		badgeProperty: null,
		subtitleProperty: null,
		titleProperty: [entityField("book", "name")],
		imageProperty: [entityField("book", "image")],
	},
	list: {
		badgeProperty: null,
		subtitleProperty: null,
		titleProperty: [entityField("book", "name")],
		imageProperty: [entityField("book", "image")],
	},
} satisfies DisplayConfigurationInput;

export function buildSavedViewBody(
	overrides: CreateSavedViewInput = {},
): CreateSavedViewBody {
	const displayConfiguration = overrides.displayConfiguration
		? normalizeDisplayConfiguration(overrides.displayConfiguration)
		: normalizeDisplayConfiguration(defaultDisplayConfiguration);

	return {
		icon: "star",
		accentColor: "#FF5733",
		queryDefinition: defaultQueryDefinition,
		name: `Saved View ${crypto.randomUUID()}`,
		...overrides,
		displayConfiguration,
	};
}

export function buildUpdatedSavedViewBody(
	overrides: UpdateSavedViewInput = {},
): UpdateSavedViewBody {
	const displayConfiguration = overrides.displayConfiguration
		? normalizeDisplayConfiguration(overrides.displayConfiguration)
		: normalizeDisplayConfiguration({
				table: {
					columns: [
						{ label: "Name", expression: [entityField("book", "name")] },
						{ label: "Year", expression: [entityField("book", "publishYear")] },
					],
				},
				grid: {
					imageProperty: null,
					titleProperty: null,
					badgeProperty: null,
					subtitleProperty: null,
				},
				list: {
					titleProperty: [entityField("book", "name")],
					imageProperty: [entityField("book", "image")],
					subtitleProperty: [entityField("book", "publishYear")],
					badgeProperty: [entityField("anime", "productionStatus")],
				},
			});

	return {
		icon: "heart",
		isDisabled: false,
		accentColor: "#00AA88",
		name: `Updated View ${crypto.randomUUID()}`,
		queryDefinition: {
			computedFields: [],
			eventJoins: [],
			entitySchemaSlugs: ["book", "anime"],
			sort: { fields: [entityField("book", "createdAt")], direction: "desc" },
			filters: [
				{ op: "gte", field: entityField("book", "publishYear"), value: 2020 },
			],
		} as UpdateSavedViewBody["queryDefinition"],
		...overrides,
		displayConfiguration,
	};
}

export async function createSavedView(
	client: Client,
	cookies: string,
	overrides: CreateSavedViewInput = {},
) {
	const { data, response } = await client.POST("/saved-views", {
		headers: { Cookie: cookies },
		body: buildSavedViewBody(overrides),
	});

	if (response.status !== 200 || !data?.data) {
		throw new Error("Failed to create saved view");
	}

	return data.data;
}

export async function listSavedViews(
	client: Client,
	cookies: string,
	options: { trackerId?: string; includeDisabled?: boolean } = {},
) {
	const includeDisabled = options.includeDisabled ? "true" : undefined;
	const { data, response } = await client.GET("/saved-views", {
		headers: { Cookie: cookies },
		params: { query: { includeDisabled, trackerId: options.trackerId } },
	});

	if (response.status !== 200 || !data?.data) {
		throw new Error("Failed to list saved views");
	}

	return data.data;
}

export async function findBuiltinSavedView(client: Client, cookies: string) {
	const views = await listSavedViews(client, cookies);
	const builtinView = views.find((view) => view.isBuiltin);

	if (!builtinView) {
		throw new Error("Built-in saved view not found");
	}

	return builtinView;
}

export async function getSavedView(
	client: Client,
	cookies: string,
	viewId: string,
) {
	const { data, response } = await client.GET("/saved-views/{viewId}", {
		headers: { Cookie: cookies },
		params: { path: { viewId } },
	});

	if (response.status !== 200 || !data?.data) {
		throw new Error(`Failed to get saved view '${viewId}'`);
	}

	return data.data;
}

export async function updateSavedView(
	client: Client,
	cookies: string,
	viewId: string,
	overrides: UpdateSavedViewInput = {},
) {
	const { data, response } = await client.PUT("/saved-views/{viewId}", {
		headers: { Cookie: cookies },
		params: { path: { viewId } },
		body: buildUpdatedSavedViewBody(overrides),
	});

	if (response.status !== 200 || !data?.data) {
		throw new Error(`Failed to update saved view '${viewId}'`);
	}

	return data.data;
}

export async function cloneSavedView(
	client: Client,
	cookies: string,
	viewId: string,
) {
	const { data, response } = await client.POST("/saved-views/{viewId}/clone", {
		headers: { Cookie: cookies },
		params: { path: { viewId } },
	});

	if (response.status !== 200 || !data?.data) {
		throw new Error(`Failed to clone saved view '${viewId}'`);
	}

	return data.data;
}

export async function deleteSavedView(
	client: Client,
	cookies: string,
	viewId: string,
) {
	const { data, response } = await client.DELETE("/saved-views/{viewId}", {
		headers: { Cookie: cookies },
		params: { path: { viewId } },
	});

	if (response.status !== 200 || !data?.data) {
		throw new Error(`Failed to delete saved view '${viewId}'`);
	}

	return data.data;
}

export async function reorderSavedViews(
	client: Client,
	cookies: string,
	body: ReorderSavedViewsBody,
) {
	const { data, response } = await client.POST("/saved-views/reorder", {
		body,
		headers: { Cookie: cookies },
	});

	if (response.status !== 200 || !data?.data) {
		throw new Error("Failed to reorder saved views");
	}

	return data.data;
}
