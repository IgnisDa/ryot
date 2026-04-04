import {
	and,
	eq,
	gt,
	gte,
	inArray,
	isNull,
	lt,
	lte,
	ne,
	or,
	sql,
} from "drizzle-orm";
import { match } from "ts-pattern";
import { ViewRuntimeValidationError } from "~/lib/views/errors";
import {
	getPropertyType,
	getSchemaForReference,
	type PropertyType,
	resolveRuntimeReference,
	type ViewRuntimeSchemaLike,
} from "~/lib/views/reference";
import type { FilterExpression } from "../saved-views/schemas";
import { buildCastedValueExpression } from "./runtime-reference";

const buildPropertyFilterExpression = <
	TSchema extends ViewRuntimeSchemaLike,
>(input: {
	alias: string;
	schemaMap: Map<string, TSchema>;
	reference: Extract<
		ReturnType<typeof resolveRuntimeReference>,
		{ type: "schema-property" }
	>;
}) => {
	const foundSchema = getSchemaForReference(input.schemaMap, input.reference);
	const propertyType = getPropertyType(foundSchema, input.reference.property);
	if (!propertyType) {
		throw new ViewRuntimeValidationError(
			`Property '${input.reference.property}' not found in schema '${input.reference.slug}'`,
		);
	}

	const expression = buildCastedValueExpression(propertyType, {
		propertyJson: sql`${sql.raw(input.alias)}.properties -> ${input.reference.property}`,
		propertyText: sql`${sql.raw(input.alias)}.properties ->> ${input.reference.property}`,
	});

	return { expression, propertyType };
};

const buildTopLevelColumnType = (column: string): PropertyType | null =>
	match(column)
		.with("name", () => "string" as const)
		.with("createdAt", "updatedAt", () => "date" as const)
		.otherwise(() => null);

const buildTopLevelFilterExpression = (alias: string, column: string) =>
	match(column)
		.with("name", () => sql`${sql.raw(alias)}.name`)
		.with("createdAt", () => sql`${sql.raw(alias)}.created_at`)
		.with("updatedAt", () => sql`${sql.raw(alias)}.updated_at`)
		.with("image", () => {
			throw new ViewRuntimeValidationError(
				"Unsupported filter column '@image'",
			);
		})
		.otherwise(() => {
			throw new ViewRuntimeValidationError(
				`Unsupported filter column '@${column}'`,
			);
		});

const buildFilterOperationClause = (
	filter: FilterExpression,
	expression: ReturnType<typeof sql>,
	propertyType?: PropertyType,
) =>
	match(filter)
		.with({ op: "isNull" }, () => isNull(expression))
		.with({ op: "eq" }, ({ value }) => eq(expression, value))
		.with({ op: "ne" }, ({ value }) => ne(expression, value))
		.with({ op: "gt" }, ({ value }) => gt(expression, value))
		.with({ op: "lt" }, ({ value }) => lt(expression, value))
		.with({ op: "gte" }, ({ value }) => gte(expression, value))
		.with({ op: "lte" }, ({ value }) => lte(expression, value))
		.with({ op: "in" }, ({ value }) => {
			if (!Array.isArray(value)) {
				throw new ViewRuntimeValidationError(
					"Filter operator 'in' requires an array value",
				);
			}

			return inArray(expression, value);
		})
		.with({ op: "contains" }, ({ value }) => {
			if (propertyType === "array") {
				if (Array.isArray(value)) {
					throw new ViewRuntimeValidationError(
						"Filter operator 'contains' for array properties requires a scalar value",
					);
				}
				return sql`${expression} @> ${JSON.stringify([value])}::jsonb`;
			}
			if (propertyType === "object") {
				return sql`${expression} @> ${JSON.stringify(value)}::jsonb`;
			}
			if (propertyType !== undefined && propertyType !== "string") {
				throw new ViewRuntimeValidationError(
					`Filter operator 'contains' is not supported for property type '${propertyType}'`,
				);
			}
			const safe = String(value)
				.replace(/\\/g, "\\\\")
				.replace(/%/g, "\\%")
				.replace(/_/g, "\\_");
			return sql`${expression} ilike ${`%${safe}%`} escape '\\'`;
		})
		.exhaustive();

const buildFilterClauseForSchema = <
	TSchema extends ViewRuntimeSchemaLike,
>(input: {
	alias: string;
	schemaSlug: string;
	filter: FilterExpression;
	schemaMap: Map<string, TSchema>;
}) => {
	const reference = input.filter.field;
	const parsedReference = resolveRuntimeReference(reference);

	if (parsedReference.type === "top-level") {
		const expression = buildTopLevelFilterExpression(
			input.alias,
			parsedReference.column,
		);
		const topLevelType =
			buildTopLevelColumnType(parsedReference.column) ?? undefined;
		return buildFilterOperationClause(input.filter, expression, topLevelType);
	}

	if (parsedReference.slug !== input.schemaSlug) {
		getSchemaForReference(input.schemaMap, parsedReference);
		return undefined;
	}

	const { expression, propertyType } = buildPropertyFilterExpression({
		alias: input.alias,
		schemaMap: input.schemaMap,
		reference: parsedReference,
	});

	return buildFilterOperationClause(input.filter, expression, propertyType);
};

export const buildFilterWhereClause = <
	TSchema extends ViewRuntimeSchemaLike,
>(input: {
	alias: string;
	entitySchemaSlugs: string[];
	filters: FilterExpression[];
	schemaMap: Map<string, TSchema>;
	schemaSlugExpression?: ReturnType<typeof sql>;
}) => {
	if (!input.filters.length) {
		return undefined;
	}

	const schemaGroups = [...new Set(input.entitySchemaSlugs)].map(
		(schemaSlug) => {
			const clauses = input.filters.flatMap((filter) => {
				const clause = buildFilterClauseForSchema({
					filter,
					schemaSlug,
					alias: input.alias,
					schemaMap: input.schemaMap,
				});

				return clause ? [clause] : [];
			});

			return and(
				eq(
					input.schemaSlugExpression ??
						sql`${sql.raw(input.alias)}.entity_schema_slug`,
					schemaSlug,
				),
				...clauses,
			);
		},
	);

	return or(...schemaGroups);
};
