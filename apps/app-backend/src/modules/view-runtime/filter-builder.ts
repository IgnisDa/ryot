import {
	and,
	eq,
	gt,
	gte,
	inArray,
	isNotNull,
	isNull,
	lt,
	lte,
	ne,
	or,
	sql,
} from "drizzle-orm";
import { match } from "ts-pattern";
import { ViewRuntimeValidationError } from "~/lib/views/errors";
import type { FilterExpression } from "~/lib/views/filtering";
import {
	getEntityColumnPropertyType,
	getEventJoinColumnPropertyType,
	getEventJoinForReference,
	getEventJoinPropertyType,
	getPropertyType,
	getSchemaForReference,
	type PropertyType,
	resolveRuntimeReference,
	type ViewRuntimeEventJoinLike,
	type ViewRuntimeReferenceContext,
	type ViewRuntimeSchemaLike,
} from "~/lib/views/reference";
import { buildCastedValueExpression } from "./sql-expression-policy";

const getEventJoinColumnName = (joinKey: string) => `event_join_${joinKey}`;

const buildEventJoinJsonColumnExpression = (alias: string, joinKey: string) => {
	return sql`${sql.raw(`${alias}.${getEventJoinColumnName(joinKey)}`)}`;
};

const buildPropertyFilterExpression = <
	TSchema extends ViewRuntimeSchemaLike,
	TJoin extends ViewRuntimeEventJoinLike,
>(input: {
	alias: string;
	context: ViewRuntimeReferenceContext<TSchema, TJoin>;
	reference: Extract<
		ReturnType<typeof resolveRuntimeReference>,
		{ type: "schema-property" }
	>;
}) => {
	const foundSchema = getSchemaForReference(
		input.context.schemaMap,
		input.reference,
	);
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

const buildEventJoinPropertyFilterExpression = <
	TSchema extends ViewRuntimeSchemaLike,
	TJoin extends ViewRuntimeEventJoinLike,
>(input: {
	alias: string;
	context: ViewRuntimeReferenceContext<TSchema, TJoin>;
	reference: Extract<
		ReturnType<typeof resolveRuntimeReference>,
		{ type: "event-join-property" }
	>;
}) => {
	const join = getEventJoinForReference(
		input.context.eventJoinMap,
		input.reference,
	);
	const propertyType = getEventJoinPropertyType(join, input.reference.property);
	if (!propertyType) {
		throw new ViewRuntimeValidationError(
			`Property '${input.reference.property}' not found for event join '${join.key}'`,
		);
	}

	const joinColumn = buildEventJoinJsonColumnExpression(
		input.alias,
		input.reference.joinKey,
	);
	const expression = buildCastedValueExpression(propertyType, {
		propertyJson: sql`${joinColumn} -> 'properties' -> ${input.reference.property}`,
		propertyText: sql`${joinColumn} -> 'properties' ->> ${input.reference.property}`,
	});

	return { expression, propertyType };
};

const buildEntityColumnFilterExpression = (alias: string, column: string) =>
	match(column)
		.with("id", () => sql`${sql.raw(alias)}.id`)
		.with("name", () => sql`${sql.raw(alias)}.name`)
		.with("createdAt", () => sql`${sql.raw(alias)}.created_at`)
		.with("updatedAt", () => sql`${sql.raw(alias)}.updated_at`)
		.with("image", () => {
			throw new ViewRuntimeValidationError(
				"Unsupported entity column '@image'",
			);
		})
		.otherwise(() => {
			throw new ViewRuntimeValidationError(
				`Unsupported entity column '@${column}'`,
			);
		});

const buildEventJoinColumnFilterExpression = (
	alias: string,
	joinKey: string,
	column: string,
) => {
	const joinColumn = buildEventJoinJsonColumnExpression(alias, joinKey);
	const propertyType = getEventJoinColumnPropertyType(column);
	if (!propertyType) {
		throw new ViewRuntimeValidationError(
			`Unsupported event join column 'event.${joinKey}.@${column}'`,
		);
	}

	return {
		propertyType,
		expression: buildCastedValueExpression(propertyType, {
			propertyJson: sql`${joinColumn} -> ${column}`,
			propertyText: sql`${joinColumn} ->> ${column}`,
		}),
	};
};

const buildFilterOperationClause = (
	filter: FilterExpression,
	expression: ReturnType<typeof sql>,
	propertyType?: PropertyType,
) =>
	match(filter)
		.with({ op: "isNull" }, () => isNull(expression))
		.with({ op: "isNotNull" }, () => isNotNull(expression))
		.with({ op: "eq" }, ({ value }) => eq(expression, value))
		.with({ op: "neq" }, ({ value }) => ne(expression, value))
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
	TJoin extends ViewRuntimeEventJoinLike,
>(input: {
	alias: string;
	schemaSlug: string;
	filter: FilterExpression;
	context: ViewRuntimeReferenceContext<TSchema, TJoin>;
}) => {
	const parsedReference = resolveRuntimeReference(input.filter.field);

	if (parsedReference.type === "entity-column") {
		if (parsedReference.slug !== input.schemaSlug) {
			getSchemaForReference(input.context.schemaMap, parsedReference);
			return undefined;
		}

		const expression = buildEntityColumnFilterExpression(
			input.alias,
			parsedReference.column,
		);
		const entityColumnType =
			getEntityColumnPropertyType(parsedReference.column) ?? undefined;
		return buildFilterOperationClause(
			input.filter,
			expression,
			entityColumnType,
		);
	}

	if (parsedReference.type === "event-join-column") {
		getEventJoinForReference(input.context.eventJoinMap, parsedReference);
		const { expression, propertyType } = buildEventJoinColumnFilterExpression(
			input.alias,
			parsedReference.joinKey,
			parsedReference.column,
		);
		return buildFilterOperationClause(input.filter, expression, propertyType);
	}

	if (parsedReference.type === "event-join-property") {
		const { expression, propertyType } = buildEventJoinPropertyFilterExpression(
			{
				alias: input.alias,
				context: input.context,
				reference: parsedReference,
			},
		);
		return buildFilterOperationClause(input.filter, expression, propertyType);
	}

	if (parsedReference.slug !== input.schemaSlug) {
		getSchemaForReference(input.context.schemaMap, parsedReference);
		return undefined;
	}

	const { expression, propertyType } = buildPropertyFilterExpression({
		alias: input.alias,
		context: input.context,
		reference: parsedReference,
	});

	return buildFilterOperationClause(input.filter, expression, propertyType);
};

export const buildFilterWhereClause = <
	TSchema extends ViewRuntimeSchemaLike,
	TJoin extends ViewRuntimeEventJoinLike,
>(input: {
	alias: string;
	entitySchemaSlugs: string[];
	filters: FilterExpression[];
	schemaSlugExpression?: ReturnType<typeof sql>;
	context: ViewRuntimeReferenceContext<TSchema, TJoin>;
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
					context: input.context,
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
