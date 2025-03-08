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
import type { EntitySchemaPropertiesShape } from "../entity-schemas/service";
import type { FilterExpression } from "../saved-views/schemas";
import { ViewRuntimeValidationError } from "./errors";
import {
	getPropertyType,
	type PropertyType,
	parseFieldPath,
} from "./schema-introspection";

type ViewRuntimeSchema = {
	slug: string;
	propertiesSchema: EntitySchemaPropertiesShape;
};

type RuntimeRef =
	| { type: "top-level"; column: string }
	| { type: "schema-property"; slug: string; property: string };

const resolveRuntimeReference = (
	reference: string,
	defaultSchemaSlug: string,
): RuntimeRef => {
	try {
		if (reference.startsWith("@")) {
			return parseFieldPath(reference);
		}
		if (reference.includes(".")) {
			return parseFieldPath(reference);
		}
	} catch (error) {
		throw new ViewRuntimeValidationError(
			error instanceof Error ? error.message : "Invalid field reference",
		);
	}

	return {
		property: reference,
		type: "schema-property",
		slug: defaultSchemaSlug,
	};
};

const getSchemaForReference = (
	schemaMap: Map<string, ViewRuntimeSchema>,
	reference: Extract<RuntimeRef, { type: "schema-property" }>,
) => {
	const foundSchema = schemaMap.get(reference.slug);
	if (!foundSchema) {
		throw new ViewRuntimeValidationError(
			`Schema '${reference.slug}' is not part of this runtime request`,
		);
	}

	return foundSchema;
};

const buildCastedValueExpression = (
	propertyType: PropertyType,
	input: {
		propertyText: ReturnType<typeof sql>;
		propertyJson: ReturnType<typeof sql>;
	},
) => {
	switch (propertyType) {
		case "integer":
			return sql`(${input.propertyText})::integer`;
		case "number":
			return sql`(${input.propertyText})::numeric`;
		case "boolean":
			return sql`(${input.propertyText})::boolean`;
		case "date":
			return sql`(${input.propertyText})::timestamp`;
		case "array":
		case "object":
			return input.propertyJson;
		default:
			return input.propertyText;
	}
};

const buildPropertyFilterExpression = (input: {
	alias: string;
	schemaMap: Map<string, ViewRuntimeSchema>;
	reference: Extract<RuntimeRef, { type: "schema-property" }>;
}) => {
	const foundSchema = getSchemaForReference(input.schemaMap, input.reference);
	const propertyType = getPropertyType(foundSchema, input.reference.property);
	if (!propertyType) {
		throw new ViewRuntimeValidationError(
			`Property '${input.reference.property}' not found in schema '${input.reference.slug}'`,
		);
	}

	return buildCastedValueExpression(propertyType, {
		propertyJson: sql`${sql.raw(input.alias)}.properties -> ${input.reference.property}`,
		propertyText: sql`${sql.raw(input.alias)}.properties ->> ${input.reference.property}`,
	});
};

const buildTopLevelFilterExpression = (alias: string, column: string) => {
	switch (column) {
		case "name":
			return sql`${sql.raw(alias)}.name`;
		case "createdAt":
			return sql`${sql.raw(alias)}.created_at`;
		case "updatedAt":
			return sql`${sql.raw(alias)}.updated_at`;
		case "image":
			throw new ViewRuntimeValidationError(
				"Unsupported filter column '@image'",
			);
		default:
			throw new ViewRuntimeValidationError(
				`Unsupported filter column '@${column}'`,
			);
	}
};

const buildFilterOperationClause = (
	filter: FilterExpression,
	expression: ReturnType<typeof sql>,
) => {
	switch (filter.op) {
		case "eq":
			return eq(expression, filter.value);
		case "ne":
			return ne(expression, filter.value);
		case "gt":
			return gt(expression, filter.value);
		case "gte":
			return gte(expression, filter.value);
		case "lt":
			return lt(expression, filter.value);
		case "lte":
			return lte(expression, filter.value);
		case "in":
			if (!Array.isArray(filter.value)) {
				throw new ViewRuntimeValidationError(
					"Filter operator 'in' requires an array value",
				);
			}
			return inArray(expression, filter.value);
		case "isNull":
			return isNull(expression);
	}
};

const buildCoalescedExpression = (expressions: ReturnType<typeof sql>[]) => {
	if (expressions.length === 1) {
		return expressions[0] ?? sql`null`;
	}

	return sql`coalesce(${sql.join(expressions, sql`, `)})`;
};

const buildFilterClauseForSchema = (input: {
	alias: string;
	isMultiSchema: boolean;
	schemaSlug: string;
	filter: FilterExpression;
	defaultSchemaSlug: string;
	schemaMap: Map<string, ViewRuntimeSchema>;
}) => {
	const expressions = input.filter.field.flatMap((reference) => {
		if (
			!reference.startsWith("@") &&
			!reference.includes(".") &&
			input.isMultiSchema
		) {
			throw new ViewRuntimeValidationError(
				"Schema-qualified filter fields are required for multi-schema requests",
			);
		}

		const parsedReference = resolveRuntimeReference(
			reference,
			input.defaultSchemaSlug,
		);

		if (parsedReference.type === "top-level") {
			return [
				buildTopLevelFilterExpression(input.alias, parsedReference.column),
			];
		}

		if (parsedReference.slug !== input.schemaSlug) {
			getSchemaForReference(input.schemaMap, parsedReference);
			return [];
		}

		return [
			buildPropertyFilterExpression({
				alias: input.alias,
				schemaMap: input.schemaMap,
				reference: parsedReference,
			}),
		];
	});

	if (!expressions.length) {
		return undefined;
	}

	return buildFilterOperationClause(
		input.filter,
		buildCoalescedExpression(expressions),
	);
};

export const buildFilterWhereClause = (input: {
	alias: string;
	defaultSchemaSlug: string;
	entitySchemaSlugs: string[];
	filters: FilterExpression[];
	schemaMap: Map<string, ViewRuntimeSchema>;
	schemaSlugExpression?: ReturnType<typeof sql>;
}) => {
	if (!input.filters.length) {
		return undefined;
	}
	const isMultiSchema = new Set(input.entitySchemaSlugs).size > 1;

	const schemaGroups = [...new Set(input.entitySchemaSlugs)].map(
		(schemaSlug) => {
			const clauses = input.filters.flatMap((filter) => {
				const clause = buildFilterClauseForSchema({
					filter,
					schemaSlug,
					isMultiSchema,
					alias: input.alias,
					schemaMap: input.schemaMap,
					defaultSchemaSlug: input.defaultSchemaSlug,
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
