import type { RuntimeRef } from "@ryot/ts-utils";
import { sql } from "drizzle-orm";
import { match } from "ts-pattern";
import { event, eventSchema } from "~/lib/db/schema";
import { QueryEngineValidationError } from "~/lib/views/errors";
import { normalizeExpressionPropertyType } from "~/lib/views/expression-analysis";
import type { PropertyType } from "~/lib/views/reference";
import {
	getEventColumnPropertyType,
	getEventJoinColumnPropertyType,
	getEventJoinForReference,
	getEventJoinPropertyType,
	getEventSchemaColumnPropertyType,
	getPropertyType,
} from "~/lib/views/reference";
import type { QueryEngineContext } from "./schemas";
import {
	buildJsonColumnPropertyExpression,
	buildPropertyPathExpression,
	castExpressionToType,
	type SqlExpression,
	sanitizeIdentifier,
} from "./sql-expression-helpers";

export const buildEventJoinExpression = (input: {
	alias: string;
	targetType?: PropertyType;
	context: QueryEngineContext;
	reference: Extract<RuntimeRef, { type: "event-join" }>;
}) => {
	const joinColumn = sql`${sql.raw(`${sanitizeIdentifier(input.alias, "table alias")}.event_join_${input.reference.joinKey}`)}`;

	if (input.reference.path[0] === "properties") {
		const propertyPath = input.reference.path.slice(1);
		const join = getEventJoinForReference(
			input.context.eventJoinMap,
			input.reference,
		);
		const propertyType = getEventJoinPropertyType(join, propertyPath);

		return buildJsonColumnPropertyExpression({
			propertyPath,
			propertyType,
			targetType: input.targetType,
			base: sql`${joinColumn} -> ${"properties"}`,
		});
	}

	const [column] = input.reference.path;
	if (!column) {
		throw new QueryEngineValidationError(
			"Event join reference path must not be empty",
		);
	}
	const propertyType = getEventJoinColumnPropertyType(column);
	if (!propertyType) {
		throw new QueryEngineValidationError(
			`Unsupported event join column 'event.${input.reference.joinKey}.${column}'`,
		);
	}

	return buildJsonColumnPropertyExpression({
		propertyPath: [column],
		propertyType,
		targetType: input.targetType,
		base: joinColumn,
	});
};

export const buildEventAggregateExpression = (input: {
	alias: string;
	targetType?: PropertyType;
	context: QueryEngineContext;
	reference: Extract<RuntimeRef, { type: "event-aggregate" }>;
}) => {
	const { userId } = input.context;
	if (!userId) {
		throw new QueryEngineValidationError(
			"Event aggregate expressions require a user context",
		);
	}

	const { aggregation, eventSchemaSlug, path } = input.reference;
	const safeAlias = sanitizeIdentifier(input.alias, "table alias");
	const entityIdExpr = sql`${sql.raw(safeAlias)}.id`;
	const actualType: PropertyType =
		aggregation === "count" ? "integer" : "number";

	let subquery: SqlExpression;
	if (aggregation === "count") {
		subquery = sql`(
			select count(*)
			from ${event} as e_agg
			inner join ${eventSchema} as es_agg on e_agg.event_schema_id = es_agg.id
			where e_agg.user_id = ${userId}
				and e_agg.entity_id = ${entityIdExpr}
				and es_agg.slug = ${eventSchemaSlug}
		)`;
	} else {
		const propertyPath = path.slice(1);
		const propertiesBase = sql.raw("e_agg.properties");
		const propertyJsonExpr = buildPropertyPathExpression(
			propertiesBase,
			propertyPath,
			"json",
		);
		const propertyTextExpr = buildPropertyPathExpression(
			propertiesBase,
			propertyPath,
			"text",
		);
		const numericValue = sql`case when jsonb_typeof(${propertyJsonExpr}) = 'number' then (${propertyTextExpr})::numeric else null end`;
		const aggFn = match(aggregation)
			.with("avg", () => sql.raw("avg"))
			.with("max", () => sql.raw("max"))
			.with("min", () => sql.raw("min"))
			.with("sum", () => sql.raw("sum"))
			.exhaustive();
		subquery = sql`(
			select ${aggFn}(${numericValue})
			from ${event} as e_agg
			inner join ${eventSchema} as es_agg on e_agg.event_schema_id = es_agg.id
			where e_agg.user_id = ${userId}
				and e_agg.entity_id = ${entityIdExpr}
				and es_agg.slug = ${eventSchemaSlug}
		)`;
	}

	return input.targetType
		? castExpressionToType(subquery, input.targetType)
		: castExpressionToType(subquery, actualType);
};

export const buildEventExpression = (input: {
	alias: string;
	targetType?: PropertyType;
	context: QueryEngineContext;
	reference: Extract<RuntimeRef, { type: "event" }>;
}) => {
	const safeAlias = sanitizeIdentifier(input.alias, "table alias");

	if (input.reference.path[0] === "properties") {
		const propertyPath = input.reference.path.slice(1);
		const { eventSchemaSlug } = input.reference;

		const propertyType = (() => {
			if (eventSchemaSlug && input.context.eventSchemaMap) {
				const eventSchemas = input.context.eventSchemaMap.get(eventSchemaSlug);
				const [schema] = eventSchemas ?? [];
				if (schema) {
					return getPropertyType(schema, propertyPath) ?? "string";
				}
			}

			return "string" as const;
		})();

		const valueExpression = buildJsonColumnPropertyExpression({
			propertyPath,
			propertyType,
			targetType: input.targetType,
			base: sql`${sql.raw(safeAlias)}.properties`,
		});

		if (!eventSchemaSlug) {
			return valueExpression;
		}

		return sql`case when ${sql.raw(safeAlias)}.event_schema_data ->> ${"slug"} = ${eventSchemaSlug} then ${valueExpression} else null end`;
	}

	const [column] = input.reference.path;
	if (!column) {
		throw new QueryEngineValidationError(
			"Event reference path must not be empty",
		);
	}

	const propertyType = getEventColumnPropertyType(column);
	if (!propertyType) {
		throw new QueryEngineValidationError(
			`Unsupported event column 'event.${column}'`,
		);
	}

	const expression = match(column)
		.with("id", () => sql`${sql.raw(safeAlias)}.id`)
		.with("createdAt", () => sql`${sql.raw(safeAlias)}.created_at`)
		.with("updatedAt", () => sql`${sql.raw(safeAlias)}.updated_at`)
		.otherwise(() => {
			throw new QueryEngineValidationError(
				`Unsupported event column 'event.${column}'`,
			);
		});

	return input.targetType
		? castExpressionToType(expression, input.targetType)
		: castExpressionToType(
				expression,
				normalizeExpressionPropertyType(propertyType),
			);
};

export const buildEventSchemaExpression = (input: {
	alias: string;
	targetType?: PropertyType;
	reference: Extract<RuntimeRef, { type: "event-schema" }>;
}) => {
	const [column] = input.reference.path;
	if (!column) {
		throw new QueryEngineValidationError(
			"Event schema reference path must not be empty",
		);
	}

	if (input.reference.path.length > 1) {
		throw new QueryEngineValidationError(
			"Event schema references do not support nested paths",
		);
	}

	const propertyType = getEventSchemaColumnPropertyType(column);
	if (!propertyType) {
		throw new QueryEngineValidationError(
			`Unsupported event schema column '${column}'`,
		);
	}

	const safeAlias = sanitizeIdentifier(input.alias, "table alias");
	const expression = sql`${sql.raw(safeAlias)}.event_schema_data ->> ${column}`;

	return input.targetType
		? castExpressionToType(expression, input.targetType)
		: castExpressionToType(
				expression,
				normalizeExpressionPropertyType(propertyType),
			);
};
