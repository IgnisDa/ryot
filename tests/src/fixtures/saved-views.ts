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
type ViewExpression =
	CreateSavedViewBody["queryDefinition"]["sort"]["expression"];
type ViewPredicate = NonNullable<
	CreateSavedViewBody["queryDefinition"]["filter"]
>;
type RuntimeRef = Extract<ViewExpression, { type: "reference" }>["reference"];

type LegacyFilter = {
	op:
		| "eq"
		| "neq"
		| "gt"
		| "gte"
		| "lt"
		| "lte"
		| "in"
		| "contains"
		| "isNull"
		| "isNotNull";
	field: string;
	value?: unknown;
};

type LegacySort = {
	direction: "asc" | "desc";
	fields: string[];
};

type ExpressionInput = ViewExpression | string[];

type CreateSavedViewInput = Partial<
	Omit<CreateSavedViewBody, "displayConfiguration" | "queryDefinition">
> & {
	displayConfiguration?: DisplayConfigurationInput;
	queryDefinition?: unknown;
};

type UpdateSavedViewInput = Partial<
	Omit<UpdateSavedViewBody, "displayConfiguration" | "queryDefinition">
> & {
	displayConfiguration?: DisplayConfigurationInput;
	queryDefinition?:
		| NormalizedQueryDefinition
		| LegacyQueryDefinition
		| UpdateSavedViewBody["queryDefinition"];
};

type LegacyQueryDefinition = {
	entitySchemaSlugs: string[];
	eventJoins?: unknown[];
	computedFields?: unknown[];
	sort: LegacySort;
	filters?: LegacyFilter[];
	filter?: ViewPredicate | null;
};

type NormalizedQueryDefinition = {
	filter: ViewPredicate | null;
	eventJoins: unknown[];
	computedFields: unknown[];
	entitySchemaSlugs: string[];
	sort: { direction: "asc" | "desc"; expression: ViewExpression };
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

const toPredicate = (filter: LegacyFilter): ViewPredicate => {
	const expression = toExpression([filter.field]) ?? literalExpression(null);
	if (filter.op === "isNull") {
		return { type: "isNull", expression };
	}

	if (filter.op === "isNotNull") {
		return { type: "isNotNull", expression };
	}

	if (filter.op === "contains") {
		return {
			type: "contains",
			expression,
			value: literalExpression(filter.value ?? null),
		};
	}

	if (filter.op === "in") {
		return {
			type: "in",
			expression,
			values: Array.isArray(filter.value)
				? filter.value.map((value) => literalExpression(value))
				: [literalExpression(filter.value ?? null)],
		};
	}

	return {
		type: "comparison",
		left: expression,
		right: literalExpression(filter.value ?? null),
		operator: filter.op,
	};
};

const getFilterGroupKey = (filter: LegacyFilter) => {
	const reference = parseReference(filter.field);
	return reference.type === "entity-column" ||
		reference.type === "schema-property"
		? reference.slug
		: `${reference.type}:${JSON.stringify(reference)}`;
};

const combinePredicates = (predicates: ViewPredicate[], type: "and" | "or") => {
	if (!predicates.length) {
		return null;
	}

	if (predicates.length === 1) {
		return predicates[0] ?? null;
	}

	return { type, predicates } satisfies ViewPredicate;
};

const toFilterPredicate = (
	filters?: LegacyFilter[],
	filter?: ViewPredicate | null,
) => {
	if (filter !== undefined) {
		return filter;
	}

	if (!filters?.length) {
		return null;
	}

	const grouped = new Map<string, ViewPredicate[]>();
	for (const entry of filters) {
		const key = getFilterGroupKey(entry);
		const existing = grouped.get(key) ?? [];
		existing.push(toPredicate(entry));
		grouped.set(key, existing);
	}

	const groupedPredicates = Array.from(grouped.values())
		.map((predicates) => combinePredicates(predicates, "and"))
		.filter((predicate): predicate is ViewPredicate => predicate !== null);

	return combinePredicates(groupedPredicates, "or");
};

const isNormalizedQueryDefinition = (
	input: unknown,
): input is NormalizedQueryDefinition => {
	if (!input || typeof input !== "object") {
		return false;
	}

	const value = input as { filter?: unknown; sort?: { expression?: unknown } };
	return "filter" in value && Boolean(value.sort?.expression);
};

const normalizeQueryDefinition = (
	input: unknown,
): NormalizedQueryDefinition => {
	if (isNormalizedQueryDefinition(input)) {
		return input;
	}

	const legacy = input as LegacyQueryDefinition;
	return {
		computedFields: legacy.computedFields ?? [],
		eventJoins: legacy.eventJoins ?? [],
		entitySchemaSlugs: legacy.entitySchemaSlugs,
		filter: toFilterPredicate(legacy.filters, legacy.filter),
		sort: {
			direction: legacy.sort.direction,
			expression: toExpression(legacy.sort.fields) ?? literalExpression(null),
		},
	};
};

const normalizeDisplayConfiguration = (
	input: DisplayConfigurationInput,
	allowNulls = true,
): CreateSavedViewBody["displayConfiguration"] =>
	({
		grid: {
			badgeProperty:
				toExpression(input.grid.badgeProperty) ??
				(allowNulls ? null : literalExpression(null)),
			titleProperty:
				toExpression(input.grid.titleProperty) ??
				(allowNulls ? null : literalExpression(null)),
			imageProperty:
				toExpression(input.grid.imageProperty) ??
				(allowNulls ? null : literalExpression(null)),
			subtitleProperty:
				toExpression(input.grid.subtitleProperty) ??
				(allowNulls ? null : literalExpression(null)),
		},
		list: {
			badgeProperty:
				toExpression(input.list.badgeProperty) ??
				(allowNulls ? null : literalExpression(null)),
			titleProperty:
				toExpression(input.list.titleProperty) ??
				(allowNulls ? null : literalExpression(null)),
			imageProperty:
				toExpression(input.list.imageProperty) ??
				(allowNulls ? null : literalExpression(null)),
			subtitleProperty:
				toExpression(input.list.subtitleProperty) ??
				(allowNulls ? null : literalExpression(null)),
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

const defaultQueryDefinition: NormalizedQueryDefinition = {
	filter: null,
	eventJoins: [],
	computedFields: [],
	entitySchemaSlugs: ["book"],
	sort: {
		direction: "asc",
		expression:
			toExpression([entityField("book", "name")]) ?? literalExpression(null),
	},
};

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
	const {
		displayConfiguration: displayOverride,
		queryDefinition,
		...rest
	} = overrides;
	const displayConfiguration = displayOverride
		? normalizeDisplayConfiguration(displayOverride)
		: normalizeDisplayConfiguration(defaultDisplayConfiguration);

	return {
		icon: "star",
		accentColor: "#FF5733",
		name: `Saved View ${crypto.randomUUID()}`,
		...rest,
		displayConfiguration,
		queryDefinition: normalizeQueryDefinition(
			queryDefinition ?? defaultQueryDefinition,
		) as unknown as CreateSavedViewBody["queryDefinition"],
	};
}

export function buildUpdatedSavedViewBody(
	overrides: UpdateSavedViewInput = {},
): UpdateSavedViewBody {
	const {
		displayConfiguration: displayOverride,
		queryDefinition,
		...rest
	} = overrides;
	const displayConfiguration = displayOverride
		? normalizeDisplayConfiguration(displayOverride, false)
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
		...rest,
		queryDefinition: normalizeQueryDefinition(
			queryDefinition ?? {
				eventJoins: [],
				computedFields: [],
				entitySchemaSlugs: ["book", "anime"],
				filters: [
					{ op: "gte", field: entityField("book", "publishYear"), value: 2020 },
				],
				sort: {
					fields: [entityField("book", "createdAt")],
					direction: "desc",
				},
			},
		) as unknown as UpdateSavedViewBody["queryDefinition"],
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
