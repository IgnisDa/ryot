import type { paths } from "@ryot/generated/openapi/app-backend";

type CreateSavedViewBody = NonNullable<
	paths["/saved-views"]["post"]["requestBody"]
>["content"]["application/json"];
type ExecuteViewRuntimeBody = NonNullable<
	paths["/view-runtime/execute"]["post"]["requestBody"]
>["content"]["application/json"];

export type ViewExpression =
	CreateSavedViewBody["queryDefinition"]["sort"]["expression"];
export type ViewPredicate = NonNullable<
	CreateSavedViewBody["queryDefinition"]["filter"]
>;
export type RuntimeRef = Extract<
	ViewExpression,
	{ type: "reference" }
>["reference"];
export type LegacyFilter = {
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
export type LegacySort = {
	fields: string[];
	direction: "asc" | "desc";
};
export type ExpressionInput = ViewExpression | string[];
export type RuntimeSortInput = LegacySort | ExecuteViewRuntimeBody["sort"];

const entityBuiltinFields = new Set([
	"id",
	"name",
	"image",
	"createdAt",
	"updatedAt",
]);

export const literalExpression = (value: unknown | null): ViewExpression => ({
	value,
	type: "literal",
});

export const entityField = (schemaSlug: string, property: string) => {
	if (entityBuiltinFields.has(property) || property.startsWith("@")) {
		return `entity.${schemaSlug}.${property.startsWith("@") ? property : `@${property}`}`;
	}

	return `entity.${schemaSlug}.${property}`;
};

export const qualifyBuiltinFields = (
	schemaSlugs: string[],
	property: string,
) => {
	return schemaSlugs.map((schemaSlug) => entityField(schemaSlug, property));
};

export const parseReference = (reference: string): RuntimeRef => {
	const [namespace, segment, tail, ...rest] = reference.split(".");
	if (namespace === "computed") {
		if (!segment || tail || rest.length > 0) {
			throw new Error(`Invalid view reference '${reference}'`);
		}

		return { type: "computed-field", key: segment };
	}

	if (namespace === "event") {
		if (!segment || !tail || rest.length > 0) {
			throw new Error(`Invalid view reference '${reference}'`);
		}

		return tail.startsWith("@")
			? { type: "event-join-column", joinKey: segment, column: tail.slice(1) }
			: { type: "event-join-property", joinKey: segment, property: tail };
	}

	if (namespace !== "entity" || !segment || !tail || rest.length > 0) {
		throw new Error(`Invalid view reference '${reference}'`);
	}

	return tail.startsWith("@")
		? { type: "entity-column", slug: segment, column: tail.slice(1) }
		: { type: "schema-property", slug: segment, property: tail };
};

export const toExpression = (
	input: ExpressionInput | null,
): ViewExpression | null => {
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
		: {
				type: "coalesce",
				values,
			};
};

export const toRequiredExpression = (input: ExpressionInput | null) => {
	return toExpression(input) ?? literalExpression(null);
};

export const toPredicate = (filter: LegacyFilter): ViewPredicate => {
	const expression = toRequiredExpression([filter.field]);
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
		left: expression,
		type: "comparison",
		operator: filter.op,
		right: literalExpression(filter.value ?? null),
	};
};

const getFilterGroupKey = (filter: LegacyFilter) => {
	const reference = parseReference(filter.field);
	return reference.type === "entity-column" ||
		reference.type === "schema-property"
		? reference.slug
		: `${reference.type}:${JSON.stringify(reference)}`;
};

export const combinePredicates = (
	predicates: ViewPredicate[],
	type: "and" | "or",
) => {
	if (!predicates.length) {
		return null;
	}

	if (predicates.length === 1) {
		return predicates[0] ?? null;
	}

	return { type, predicates } satisfies ViewPredicate;
};

export const toFilterPredicate = (
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

export const normalizeSort = (sort: RuntimeSortInput) => {
	if ("expression" in sort) {
		return sort;
	}

	return {
		direction: sort.direction,
		expression: toRequiredExpression(sort.fields),
	};
};
