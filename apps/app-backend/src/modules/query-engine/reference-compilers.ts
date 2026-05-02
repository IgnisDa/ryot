import type { RuntimeRef } from "@ryot/ts-utils";
import { sql } from "drizzle-orm";
import { match } from "ts-pattern";
import { event, eventSchema } from "~/lib/db/schema";
import { QueryEngineValidationError } from "~/lib/views/errors";
import { normalizeExpressionPropertyType } from "~/lib/views/expression-analysis";
import type {
	PropertyType,
	QueryEngineEventJoinLike,
	QueryEngineReferenceContext,
	QueryEngineSchemaLike,
} from "~/lib/views/reference";
import {
	getEntityColumnPropertyType,
	getEntitySchemaColumnPropertyType,
	getEventColumnPropertyType,
	getEventJoinColumnPropertyType,
	getEventJoinForReference,
	getEventJoinPropertyType,
	getEventSchemaColumnPropertyType,
	getPropertyType,
	getSchemaForReference,
} from "~/lib/views/reference";
import {
	buildCastedValueExpression,
	buildPropertyPathExpression,
	castExpressionToType,
	type SqlExpression,
} from "./sql-expression-helpers";

export const buildEntityExpression = <
	TSchema extends QueryEngineSchemaLike,
	TJoin extends QueryEngineEventJoinLike,
>(input: {
	alias: string;
	targetType?: PropertyType;
	reference: Extract<RuntimeRef, { type: "entity" }>;
	context: QueryEngineReferenceContext<TSchema, TJoin>;
}) => {
	const schema = getSchemaForReference(
		input.context.schemaMap,
		input.reference,
	);
	const overrides = input.context.entityColumnOverrides;

	if (input.reference.path[0] === "properties") {
		const propertyPath = input.reference.path.slice(1);
		const propertyType = getPropertyType(schema, propertyPath);
		if (!propertyType) {
			throw new QueryEngineValidationError(
				`Property '${propertyPath.join(".")}' not found in schema '${input.reference.slug}'`,
			);
		}

		const propertiesCol = overrides?.properties ?? "properties";
		const base = sql`${sql.raw(`${input.alias}.${propertiesCol}`)}`;
		const valueExpression = buildCastedValueExpression(
			input.targetType ?? normalizeExpressionPropertyType(propertyType),
			{
				propertyJson: buildPropertyPathExpression(base, propertyPath, "json"),
				propertyText: buildPropertyPathExpression(base, propertyPath, "text"),
			},
		);

		if (
			input.context.schemaMap.size === 1 &&
			input.reference.slug === schema.slug
		) {
			return valueExpression;
		}

		return sql`case when ${sql.raw(input.alias)}.entity_schema_data ->> ${"slug"} = ${input.reference.slug} then ${valueExpression} else null end`;
	}

	const [column] = input.reference.path;
	if (!column) {
		throw new QueryEngineValidationError(
			"Entity reference path must not be empty",
		);
	}

	const sqlCol = (() => {
		if (column === "id") {
			return overrides?.id ?? "id";
		}
		if (column === "createdAt") {
			return overrides?.created_at ?? "created_at";
		}
		if (column === "updatedAt") {
			return overrides?.updated_at ?? "updated_at";
		}
		return null;
	})();

	const expression = sqlCol
		? sql`${sql.raw(`${input.alias}.${sqlCol}`)}`
		: match(column)
				.with("name", () => sql`${sql.raw(input.alias)}.name`)
				.with("image", () => sql`${sql.raw(input.alias)}.image`)
				.with("externalId", () => sql`${sql.raw(input.alias)}.external_id`)
				.with(
					"sandboxScriptId",
					() => sql`${sql.raw(input.alias)}.sandbox_script_id`,
				)
				.otherwise(() => {
					throw new QueryEngineValidationError(
						`Unsupported entity column '${column}'`,
					);
				});

	const actualType =
		column === "image"
			? undefined
			: (getEntityColumnPropertyType(column) ?? undefined);
	if (column === "image" && input.targetType) {
		throw new QueryEngineValidationError(
			"Image expressions are display-only and cannot be compiled for sort or filter usage",
		);
	}

	const valueExpression = input.targetType
		? castExpressionToType(expression, input.targetType)
		: actualType
			? castExpressionToType(
					expression,
					normalizeExpressionPropertyType(actualType),
				)
			: expression;

	if (
		input.context.schemaMap.size === 1 &&
		input.context.schemaMap.has(input.reference.slug)
	) {
		return valueExpression;
	}

	return sql`case when ${sql.raw(input.alias)}.entity_schema_data ->> ${"slug"} = ${input.reference.slug} then ${valueExpression} else null end`;
};

export const buildEventJoinExpression = <
	TSchema extends QueryEngineSchemaLike,
	TJoin extends QueryEngineEventJoinLike,
>(input: {
	alias: string;
	targetType?: PropertyType;
	context: QueryEngineReferenceContext<TSchema, TJoin>;
	reference: Extract<RuntimeRef, { type: "event-join" }>;
}) => {
	const joinColumn = sql`${sql.raw(`${input.alias}.event_join_${input.reference.joinKey}`)}`;

	if (input.reference.path[0] === "properties") {
		const propertyPath = input.reference.path.slice(1);
		const join = getEventJoinForReference(
			input.context.eventJoinMap,
			input.reference,
		);
		const propertyType = getEventJoinPropertyType(join, propertyPath);

		const propertiesBase = sql`${joinColumn} -> ${"properties"}`;
		return buildCastedValueExpression(
			input.targetType ?? normalizeExpressionPropertyType(propertyType),
			{
				propertyJson: buildPropertyPathExpression(
					propertiesBase,
					propertyPath,
					"json",
				),
				propertyText: buildPropertyPathExpression(
					propertiesBase,
					propertyPath,
					"text",
				),
			},
		);
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

	return buildCastedValueExpression(
		input.targetType ?? normalizeExpressionPropertyType(propertyType),
		{
			propertyJson: sql`${joinColumn} -> ${column}`,
			propertyText: sql`${joinColumn} ->> ${column}`,
		},
	);
};

export const buildEntitySchemaExpression = (input: {
	alias: string;
	targetType?: PropertyType;
	reference: Extract<RuntimeRef, { type: "entity-schema" }>;
}) => {
	const [column] = input.reference.path;
	if (!column) {
		throw new QueryEngineValidationError(
			"Entity schema reference path must not be empty",
		);
	}

	if (input.reference.path.length > 1) {
		throw new QueryEngineValidationError(
			"Entity schema references do not support nested paths",
		);
	}

	const propertyType = getEntitySchemaColumnPropertyType(column);
	if (!propertyType) {
		throw new QueryEngineValidationError(
			`Unsupported entity schema column '${column}'`,
		);
	}

	const expression = sql`${sql.raw(input.alias)}.entity_schema_data ->> ${column}`;

	return input.targetType
		? castExpressionToType(expression, input.targetType)
		: castExpressionToType(
				expression,
				normalizeExpressionPropertyType(propertyType),
			);
};

export const buildEventAggregateExpression = <
	TSchema extends QueryEngineSchemaLike,
	TJoin extends QueryEngineEventJoinLike,
>(input: {
	alias: string;
	targetType?: PropertyType;
	context: QueryEngineReferenceContext<TSchema, TJoin>;
	reference: Extract<RuntimeRef, { type: "event-aggregate" }>;
}) => {
	const { userId } = input.context;
	if (!userId) {
		throw new QueryEngineValidationError(
			"Event aggregate expressions require a user context",
		);
	}

	const { aggregation, eventSchemaSlug, path } = input.reference;
	const entityIdExpr = sql`${sql.raw(input.alias)}.id`;
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
		const aggFn = sql.raw(aggregation);
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

export const buildEventExpression = <
	TSchema extends QueryEngineSchemaLike,
	TJoin extends QueryEngineEventJoinLike,
>(input: {
	alias: string;
	targetType?: PropertyType;
	reference: Extract<RuntimeRef, { type: "event" }>;
	context: QueryEngineReferenceContext<TSchema, TJoin>;
}) => {
	if (input.reference.path[0] === "properties") {
		const propertyPath = input.reference.path.slice(1);
		const { eventSchemaSlug } = input.reference;

		const base = sql`${sql.raw(input.alias)}.properties`;
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

		const valueExpression = buildCastedValueExpression(
			input.targetType ?? normalizeExpressionPropertyType(propertyType),
			{
				propertyJson: buildPropertyPathExpression(base, propertyPath, "json"),
				propertyText: buildPropertyPathExpression(base, propertyPath, "text"),
			},
		);

		if (!eventSchemaSlug) {
			return valueExpression;
		}

		return sql`case when ${sql.raw(input.alias)}.event_schema_data ->> ${"slug"} = ${eventSchemaSlug} then ${valueExpression} else null end`;
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
		.with("id", () => sql`${sql.raw(input.alias)}.id`)
		.with("createdAt", () => sql`${sql.raw(input.alias)}.created_at`)
		.with("updatedAt", () => sql`${sql.raw(input.alias)}.updated_at`)
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

	const expression = sql`${sql.raw(input.alias)}.event_schema_data ->> ${column}`;

	return input.targetType
		? castExpressionToType(expression, input.targetType)
		: castExpressionToType(
				expression,
				normalizeExpressionPropertyType(propertyType),
			);
};
