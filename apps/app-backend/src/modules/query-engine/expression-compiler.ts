import type { RuntimeRef } from "@ryot/ts-utils";
import { sql } from "drizzle-orm";
import { match } from "ts-pattern";
import { event, eventSchema } from "~/lib/db/schema";
import {
	buildComputedFieldMap,
	getComputedFieldOrThrow,
} from "~/lib/views/computed-fields";
import { QueryEngineValidationError } from "~/lib/views/errors";
import type { ViewComputedField, ViewExpression } from "~/lib/views/expression";
import {
	assertConcatCompatibleExpression,
	assertNumericExpression,
	inferViewExpressionType,
	normalizeExpressionPropertyType,
	type ViewExpressionTypeInfo,
} from "~/lib/views/expression-analysis";
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
	type PropertyType,
	type QueryEngineEventJoinLike,
	type QueryEngineReferenceContext,
	type QueryEngineSchemaLike,
} from "~/lib/views/reference";

import { buildPredicateClause } from "./predicate-clause-builder";
import {
	buildCastedValueExpression,
	buildCoalescedExpression,
	getEventJoinColumnName,
	type SqlExpression,
} from "./sql-expression-helpers";

const buildEventJoinJsonColumnExpression = (alias: string, joinKey: string) => {
	return sql`${sql.raw(`${alias}.${getEventJoinColumnName(joinKey)}`)}`;
};

const buildPropertyPathExpression = (
	base: SqlExpression,
	propertyPath: string[],
	mode: "json" | "text",
): SqlExpression => {
	const last = propertyPath.at(-1);
	if (!last) {
		throw new QueryEngineValidationError(
			"Property path must have at least one segment",
		);
	}

	const intermediate = propertyPath.slice(0, -1);
	let current = base;
	for (const segment of intermediate) {
		current = sql`${current} -> ${segment}`;
	}

	return mode === "text"
		? sql`${current} ->> ${last}`
		: sql`${current} -> ${last}`;
};

const buildLiteralExpression = (
	value: unknown | null,
	targetType?: PropertyType,
) => {
	if (value === null) {
		return sql`null`;
	}

	const inferredLiteralType = (() => {
		if (typeof value === "string") {
			return "string" satisfies PropertyType;
		}

		if (typeof value === "boolean") {
			return "boolean" satisfies PropertyType;
		}

		if (typeof value === "number") {
			return Number.isInteger(value)
				? ("integer" satisfies PropertyType)
				: ("number" satisfies PropertyType);
		}

		if (Array.isArray(value)) {
			return "array" satisfies PropertyType;
		}

		return "object" satisfies PropertyType;
	})();
	const propertyType = targetType ?? inferredLiteralType;

	return match(propertyType)
		.with("integer", () => sql`cast(${value} as integer)`)
		.with("number", () => sql`cast(${value} as numeric)`)
		.with("boolean", () => sql`cast(${value} as boolean)`)
		.with("date", () => sql`cast(${value} as timestamptz)`)
		.with("array", "object", () => sql`${JSON.stringify(value)}::jsonb`)
		.otherwise(() => {
			if (typeof value === "object") {
				return sql`${JSON.stringify(value)}::jsonb`;
			}

			if (typeof value === "string") {
				return sql`cast(${value} as text)`;
			}

			return sql`${value}`;
		});
};

const castExpressionToType = (
	expression: SqlExpression,
	targetType: PropertyType,
) => {
	return match(targetType)
		.with("number", () => sql`(${expression})::numeric`)
		.with("boolean", () => sql`(${expression})::boolean`)
		.with("date", () => sql`(${expression})::timestamptz`)
		.with("array", "object", () => sql`to_jsonb(${expression})`)
		.with("integer", () => sql`trunc((${expression})::numeric)::integer`)
		.otherwise(() => sql`(${expression})::text`);
};

const buildTextValueExpression = (expression: SqlExpression) => {
	return sql`coalesce((${expression})::text, '')`;
};

const buildIntegerNormalizationExpression = (expression: SqlExpression) => {
	return sql`trunc((${expression})::numeric)::integer`;
};

const buildJsonNullNormalizedExpression = (input: {
	expression: SqlExpression;
	targetType?: PropertyType;
	typeInfo: ViewExpressionTypeInfo;
}) => {
	if (
		input.targetType === "array" ||
		input.targetType === "object" ||
		(input.typeInfo.kind === "property" &&
			["array", "object"].includes(
				normalizeExpressionPropertyType(input.typeInfo.propertyType),
			))
	) {
		return sql`nullif(${input.expression}, 'null'::jsonb)`;
	}

	return input.expression;
};

const buildEntityExpression = <
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

const buildEventJoinExpression = <
	TSchema extends QueryEngineSchemaLike,
	TJoin extends QueryEngineEventJoinLike,
>(input: {
	alias: string;
	targetType?: PropertyType;
	reference: Extract<RuntimeRef, { type: "event-join" }>;
	context: QueryEngineReferenceContext<TSchema, TJoin>;
}) => {
	const joinColumn = buildEventJoinJsonColumnExpression(
		input.alias,
		input.reference.joinKey,
	);

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

const buildEntitySchemaExpression = (input: {
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

const buildEventAggregateExpression = <
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

const buildEventExpression = <
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

const buildEventSchemaExpression = (input: {
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

export const createScalarExpressionCompiler = <
	TSchema extends QueryEngineSchemaLike,
	TJoin extends QueryEngineEventJoinLike,
>(input: {
	alias: string;
	computedFields?: ViewComputedField[];
	context: QueryEngineReferenceContext<TSchema, TJoin>;
}) => {
	const computedFieldMap = buildComputedFieldMap(input.computedFields);
	const typeCache = new Map<string, ViewExpressionTypeInfo>();
	const expressionCache = new Map<string, SqlExpression>();

	const getTypeInfo = (expression: ViewExpression) => {
		return inferViewExpressionType({
			expression,
			context: input.context,
			computedFieldMap,
			typeCache,
		});
	};

	const compile = (
		expression: ViewExpression,
		targetType?: PropertyType,
	): SqlExpression => {
		if (expression.type === "literal") {
			return buildLiteralExpression(expression.value, targetType);
		}

		if (expression.type === "coalesce") {
			const typeInfo = getTypeInfo(expression);
			const coalesceTargetType =
				targetType ??
				(typeInfo.kind === "property" ? typeInfo.propertyType : undefined);
			return buildCoalescedExpression(
				expression.values.map((value) => {
					const compiledValue = compile(value, coalesceTargetType);
					return buildJsonNullNormalizedExpression({
						expression: compiledValue,
						targetType: coalesceTargetType,
						typeInfo: getTypeInfo(value),
					});
				}),
			);
		}

		if (expression.type === "arithmetic") {
			const leftType = getTypeInfo(expression.left);
			const rightType = getTypeInfo(expression.right);
			assertNumericExpression(leftType, "Arithmetic");
			assertNumericExpression(rightType, "Arithmetic");
			const arithmeticTargetType =
				targetType ??
				(expression.operator === "divide" ||
				(leftType.kind === "property" && leftType.propertyType === "number") ||
				(rightType.kind === "property" && rightType.propertyType === "number")
					? "number"
					: "integer");
			const left = compile(expression.left, arithmeticTargetType);
			const right = compile(expression.right, arithmeticTargetType);

			return match(expression.operator)
				.with("add", () => sql`(${left}) + (${right})`)
				.with("subtract", () => sql`(${left}) - (${right})`)
				.with("multiply", () => sql`(${left}) * (${right})`)
				.with("divide", () => sql`(${left}) / nullif((${right}), 0)`)
				.exhaustive();
		}

		if (expression.type === "round") {
			const expressionType = getTypeInfo(expression.expression);
			assertNumericExpression(expressionType, "Numeric normalization");
			const compiled = compile(expression.expression, "number");
			return sql`round(${compiled})::integer`;
		}

		if (expression.type === "floor") {
			const expressionType = getTypeInfo(expression.expression);
			assertNumericExpression(expressionType, "Numeric normalization");
			const compiled = compile(expression.expression, "number");
			return sql`floor(${compiled})::integer`;
		}

		if (expression.type === "integer") {
			const expressionType = getTypeInfo(expression.expression);
			assertNumericExpression(expressionType, "Numeric normalization");
			return buildIntegerNormalizationExpression(
				compile(expression.expression, "number"),
			);
		}

		if (expression.type === "concat") {
			for (const value of expression.values) {
				assertConcatCompatibleExpression(getTypeInfo(value));
			}

			return sql`concat(${sql.join(
				expression.values.map((value) =>
					buildTextValueExpression(compile(value)),
				),
				sql`, `,
			)})`;
		}

		if (expression.type === "transform") {
			assertConcatCompatibleExpression(getTypeInfo(expression.expression));
			const textExpr = buildTextValueExpression(compile(expression.expression));

			return match(expression.name)
				.with(
					"titleCase",
					() => sql`initcap(replace(replace(${textExpr}, '_', ' '), '-', ' '))`,
				)
				.with(
					"kebabCase",
					() => sql`lower(replace(replace(${textExpr}, '_', '-'), ' ', '-'))`,
				)
				.exhaustive();
		}

		if (expression.type === "conditional") {
			const typeInfo = getTypeInfo(expression);
			const conditionalTargetType =
				targetType ??
				(typeInfo.kind === "property" ? typeInfo.propertyType : undefined);
			const predicate = buildPredicateClause({
				predicate: expression.condition,
				compiler: { compile, getTypeInfo },
			});
			const whenTrue = compile(expression.whenTrue, conditionalTargetType);
			const whenFalse = compile(expression.whenFalse, conditionalTargetType);
			return sql`case when ${predicate} then ${whenTrue} else ${whenFalse} end`;
		}

		const reference = expression.reference;
		if (reference.type === "computed-field") {
			const cacheKey = `${reference.key}:${targetType ?? "base"}`;
			const cached = expressionCache.get(cacheKey);
			if (cached) {
				return cached;
			}

			const computedField = getComputedFieldOrThrow(
				computedFieldMap,
				reference.key,
			);

			const compiled = compile(computedField.expression, targetType);
			expressionCache.set(cacheKey, compiled);
			return compiled;
		}

		if (reference.type === "entity") {
			return buildEntityExpression({
				reference,
				targetType,
				alias: input.alias,
				context: input.context,
			});
		}

		if (reference.type === "entity-schema") {
			return buildEntitySchemaExpression({
				reference,
				targetType,
				alias: input.alias,
			});
		}

		if (reference.type === "event-aggregate") {
			return buildEventAggregateExpression({
				reference,
				targetType,
				alias: input.alias,
				context: input.context,
			});
		}

		if (reference.type === "event-join") {
			return buildEventJoinExpression({
				reference,
				targetType,
				alias: input.alias,
				context: input.context,
			});
		}

		if (reference.type === "event") {
			return buildEventExpression({
				reference,
				targetType,
				alias: input.alias,
				context: input.context,
			});
		}

		if (reference.type === "event-schema") {
			return buildEventSchemaExpression({
				reference,
				targetType,
				alias: input.alias,
			});
		}

		throw new QueryEngineValidationError(
			`Reference type '${(reference as { type: string }).type}' is not supported in this query mode`,
		);
	};

	return { compile, getTypeInfo };
};
