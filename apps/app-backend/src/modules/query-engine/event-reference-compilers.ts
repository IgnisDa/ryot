import { sql } from "drizzle-orm";
import { match } from "ts-pattern";

import { schema } from "~/lib/db";
import type { AppSchema } from "~/lib/property-schema";
import type { QueryExpression } from "~/lib/query-language";
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

import type { QueryEngineContext } from "./context";
import { buildSchemaReferenceExpression } from "./reference-compiler-shared";
import {
	buildJsonColumnPropertyExpression,
	buildPropertyPathExpression,
	castExpressionToType,
	sanitizeIdentifier,
	type SqlExpression,
} from "./sql-expression-helpers";

export const buildEventJoinExpression = (input: {
	alias: string;
	targetType?: PropertyType;
	context: QueryEngineContext;
	reference: Extract<QueryExpression, { type: "reference" }>["reference"] & { type: "event-join" };
}) => {
	const joinColumn = sql`${sql.raw(`${sanitizeIdentifier(input.alias, "table alias")}.event_join_${input.reference.joinKey}`)}`;

	if (input.reference.path[0] === "properties") {
		const propertyPath = input.reference.path.slice(1);
		const join = getEventJoinForReference(input.context.eventJoinMap, input.reference);
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
		throw new QueryEngineValidationError("Event join reference path must not be empty");
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
	reference: Extract<QueryExpression, { type: "reference" }>["reference"] & {
		type: "event-aggregate";
	};
}) => {
	const { userId } = input.context;
	if (!userId) {
		throw new QueryEngineValidationError("Event aggregate expressions require a user context");
	}

	const { aggregation, eventSchemaSlug } = input.reference;
	const safeAlias = sanitizeIdentifier(input.alias, "table alias");
	const entityIdExpr = sql`${sql.raw(safeAlias)}.id`;
	const actualType: PropertyType = aggregation === "count" ? "integer" : "number";

	let subquery: SqlExpression;
	if (aggregation === "count") {
		subquery = sql`(
			select count(*)
			from ${schema.event} as e_agg
			inner join ${schema.eventSchema} as es_agg on e_agg.event_schema_id = es_agg.id
			where e_agg.user_id = ${userId}
				and e_agg.entity_id = ${entityIdExpr}
				and es_agg.slug = ${eventSchemaSlug}
		)`;
	} else {
		const { path } = input.reference;
		if (!path) {
			throw new QueryEngineValidationError(
				"Event aggregate path is required for non-count aggregations",
			);
		}
		const propertyPath = path.slice(1);
		const propertiesBase = sql.raw("e_agg.properties");
		const propertyJsonExpr = buildPropertyPathExpression(propertiesBase, propertyPath, "json");
		const propertyTextExpr = buildPropertyPathExpression(propertiesBase, propertyPath, "text");
		const numericValue = sql`case when jsonb_typeof(${propertyJsonExpr}) = 'number' then (${propertyTextExpr})::numeric else null end`;
		const aggFn = match(aggregation)
			.with("avg", () => sql.raw("avg"))
			.with("max", () => sql.raw("max"))
			.with("min", () => sql.raw("min"))
			.with("sum", () => sql.raw("sum"))
			.exhaustive();
		subquery = sql`(
			select ${aggFn}(${numericValue})
			from ${schema.event} as e_agg
			inner join ${schema.eventSchema} as es_agg on e_agg.event_schema_id = es_agg.id
			where e_agg.user_id = ${userId}
				and e_agg.entity_id = ${entityIdExpr}
				and es_agg.slug = ${eventSchemaSlug}
		)`;
	}

	return input.targetType
		? castExpressionToType(subquery, input.targetType)
		: castExpressionToType(subquery, actualType);
};

const resolveEventPropertyType = (
	eventSchemaSlug: string | undefined,
	eventSchemaMap: Map<string, { slug: string; propertiesSchema: AppSchema }[]> | undefined,
	propertyPath: string[],
): PropertyType => {
	if (eventSchemaSlug && eventSchemaMap) {
		const eventSchemas = eventSchemaMap.get(eventSchemaSlug);
		const [s] = eventSchemas ?? [];
		if (s) {
			return getPropertyType(s, propertyPath) ?? "string";
		}
		throw new QueryEngineValidationError(
			`Event schema '${eventSchemaSlug}' is not available for the requested entity schemas`,
		);
	}
	return "string" as const;
};

export const buildEventExpression = (input: {
	alias: string;
	targetType?: PropertyType;
	context: QueryEngineContext;
	reference: Extract<QueryExpression, { type: "reference" }>["reference"] & { type: "event" };
}) => {
	const safeAlias = sanitizeIdentifier(input.alias, "table alias");

	if (input.reference.path[0] === "properties") {
		const propertyPath = input.reference.path.slice(1);
		const { eventSchemaSlug } = input.reference;

		const propertyType = resolveEventPropertyType(
			eventSchemaSlug,
			input.context.eventSchemaMap,
			propertyPath,
		);

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
		throw new QueryEngineValidationError("Event reference path must not be empty");
	}

	const propertyType = getEventColumnPropertyType(column);
	if (!propertyType) {
		throw new QueryEngineValidationError(`Unsupported event column 'event.${column}'`);
	}

	const expression = match(column)
		.with("id", () => sql`${sql.raw(safeAlias)}.id`)
		.with("createdAt", () => sql`${sql.raw(safeAlias)}.created_at`)
		.with("updatedAt", () => sql`${sql.raw(safeAlias)}.updated_at`)
		.with("occurredAt", () => sql`${sql.raw(safeAlias)}.occurred_at`)
		.otherwise(() => {
			throw new QueryEngineValidationError(`Unsupported event column 'event.${column}'`);
		});

	return input.targetType
		? castExpressionToType(expression, input.targetType)
		: castExpressionToType(expression, normalizeExpressionPropertyType(propertyType));
};

export const buildEventSchemaExpression = (input: {
	alias: string;
	targetType?: PropertyType;
	reference: Extract<QueryExpression, { type: "reference" }>["reference"] & {
		type: "event-schema";
	};
}) =>
	buildSchemaReferenceExpression({
		alias: input.alias,
		path: input.reference.path,
		targetType: input.targetType,
		dataColumn: "event_schema_data",
		referenceLabel: "Event schema",
		resolvePropertyType: getEventSchemaColumnPropertyType,
	});
