import { sql } from "drizzle-orm";
import { match } from "ts-pattern";
import { buildComputedFieldMap } from "~/lib/views/computed-fields";
import { ViewRuntimeValidationError } from "~/lib/views/errors";
import type {
	RuntimeRef,
	ViewComputedField,
	ViewExpression,
} from "~/lib/views/expression";
import {
	inferViewExpressionType,
	normalizeExpressionPropertyType,
	type ViewExpressionTypeInfo,
} from "~/lib/views/expression-analysis";
import {
	getEntityColumnPropertyType,
	getEventJoinColumnPropertyType,
	getEventJoinForReference,
	getEventJoinPropertyType,
	getPropertyType,
	getSchemaForReference,
	type PropertyType,
	type ViewRuntimeEventJoinLike,
	type ViewRuntimeReferenceContext,
	type ViewRuntimeSchemaLike,
} from "~/lib/views/reference";
import {
	buildCastedValueExpression,
	buildCoalescedExpression,
	type SqlExpression,
} from "./sql-expression-policy";

const getEventJoinColumnName = (joinKey: string) => `event_join_${joinKey}`;

const buildEventJoinJsonColumnExpression = (alias: string, joinKey: string) => {
	return sql`${sql.raw(`${alias}.${getEventJoinColumnName(joinKey)}`)}`;
};

const toCompilePropertyType = (propertyType: PropertyType) => {
	return normalizeExpressionPropertyType(propertyType);
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
		.with("date", () => sql`cast(${value} as timestamp)`)
		.with("array", "object", () => sql`${JSON.stringify(value)}::jsonb`)
		.otherwise(() => {
			if (typeof value === "object") {
				return sql`${JSON.stringify(value)}::jsonb`;
			}

			return sql`${value}`;
		});
};

const castExpressionToType = (
	expression: SqlExpression,
	targetType: PropertyType,
) => {
	return match(targetType)
		.with("integer", () => sql`(${expression})::integer`)
		.with("number", () => sql`(${expression})::numeric`)
		.with("boolean", () => sql`(${expression})::boolean`)
		.with("date", () => sql`(${expression})::timestamp`)
		.with("array", "object", () => sql`to_jsonb(${expression})`)
		.otherwise(() => sql`(${expression})::text`);
};

const buildEntityColumnExpression = <
	TSchema extends ViewRuntimeSchemaLike,
	TJoin extends ViewRuntimeEventJoinLike,
>(input: {
	alias: string;
	reference: Extract<RuntimeRef, { type: "entity-column" }>;
	context: ViewRuntimeReferenceContext<TSchema, TJoin>;
	targetType?: PropertyType;
}) => {
	const expression = match(input.reference.column)
		.with("id", () => sql`${sql.raw(input.alias)}.id`)
		.with("name", () => sql`${sql.raw(input.alias)}.name`)
		.with("createdAt", () => sql`${sql.raw(input.alias)}.created_at`)
		.with("updatedAt", () => sql`${sql.raw(input.alias)}.updated_at`)
		.with("image", () => sql`${sql.raw(input.alias)}.image`)
		.otherwise(() => {
			throw new ViewRuntimeValidationError(
				`Unsupported entity column '@${input.reference.column}'`,
			);
		});

	const actualType =
		input.reference.column === "image"
			? undefined
			: (getEntityColumnPropertyType(input.reference.column) ?? undefined);
	if (input.reference.column === "image" && input.targetType) {
		throw new ViewRuntimeValidationError(
			"Image expressions are display-only and cannot be compiled for sort or filter usage",
		);
	}

	const valueExpression = input.targetType
		? castExpressionToType(expression, input.targetType)
		: actualType
			? castExpressionToType(expression, toCompilePropertyType(actualType))
			: expression;

	if (
		input.context.schemaMap.size === 1 &&
		input.context.schemaMap.has(input.reference.slug)
	) {
		return valueExpression;
	}

	return sql`case when ${sql.raw(input.alias)}.entity_schema_slug = ${input.reference.slug} then ${valueExpression} else null end`;
};

const buildSchemaPropertyExpression = <
	TSchema extends ViewRuntimeSchemaLike,
	TJoin extends ViewRuntimeEventJoinLike,
>(input: {
	alias: string;
	targetType?: PropertyType;
	context: ViewRuntimeReferenceContext<TSchema, TJoin>;
	reference: Extract<RuntimeRef, { type: "schema-property" }>;
}) => {
	const schema = getSchemaForReference(
		input.context.schemaMap,
		input.reference,
	);
	const propertyType = getPropertyType(schema, input.reference.property);
	if (!propertyType) {
		throw new ViewRuntimeValidationError(
			`Property '${input.reference.property}' not found in schema '${input.reference.slug}'`,
		);
	}

	const propertyJson = sql`${sql.raw(input.alias)}.properties -> ${input.reference.property}`;
	const propertyText = sql`${sql.raw(input.alias)}.properties ->> ${input.reference.property}`;
	const valueExpression = buildCastedValueExpression(
		input.targetType ?? toCompilePropertyType(propertyType),
		{ propertyJson, propertyText },
	);

	if (
		input.context.schemaMap.size === 1 &&
		input.reference.slug === schema.slug
	) {
		return valueExpression;
	}

	return sql`case when ${sql.raw(input.alias)}.entity_schema_slug = ${input.reference.slug} then ${valueExpression} else null end`;
};

const buildEventJoinColumnExpression = (input: {
	alias: string;
	targetType?: PropertyType;
	reference: Extract<RuntimeRef, { type: "event-join-column" }>;
}) => {
	const propertyType = getEventJoinColumnPropertyType(input.reference.column);
	if (!propertyType) {
		throw new ViewRuntimeValidationError(
			`Unsupported event join column 'event.${input.reference.joinKey}.@${input.reference.column}'`,
		);
	}

	const joinColumn = buildEventJoinJsonColumnExpression(
		input.alias,
		input.reference.joinKey,
	);
	return buildCastedValueExpression(
		input.targetType ?? toCompilePropertyType(propertyType),
		{
			propertyJson: sql`${joinColumn} -> ${input.reference.column}`,
			propertyText: sql`${joinColumn} ->> ${input.reference.column}`,
		},
	);
};

const buildEventJoinPropertyExpression = <
	TSchema extends ViewRuntimeSchemaLike,
	TJoin extends ViewRuntimeEventJoinLike,
>(input: {
	alias: string;
	targetType?: PropertyType;
	context: ViewRuntimeReferenceContext<TSchema, TJoin>;
	reference: Extract<RuntimeRef, { type: "event-join-property" }>;
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
	return buildCastedValueExpression(
		input.targetType ?? toCompilePropertyType(propertyType),
		{
			propertyJson: sql`${joinColumn} -> 'properties' -> ${input.reference.property}`,
			propertyText: sql`${joinColumn} -> 'properties' ->> ${input.reference.property}`,
		},
	);
};

export const createScalarExpressionCompiler = <
	TSchema extends ViewRuntimeSchemaLike,
	TJoin extends ViewRuntimeEventJoinLike,
>(input: {
	alias: string;
	computedFields?: ViewComputedField[];
	context: ViewRuntimeReferenceContext<TSchema, TJoin>;
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
				expression.values.map((value) => compile(value, coalesceTargetType)),
			);
		}

		const reference = expression.reference;
		if (reference.type === "computed-field") {
			const cacheKey = `${reference.key}:${targetType ?? "base"}`;
			const cached = expressionCache.get(cacheKey);
			if (cached) {
				return cached;
			}

			const computedField = computedFieldMap.get(reference.key);
			if (!computedField) {
				throw new ViewRuntimeValidationError(
					`Computed field '${reference.key}' is not part of this runtime request`,
				);
			}

			const compiled = compile(computedField.expression, targetType);
			expressionCache.set(cacheKey, compiled);
			return compiled;
		}

		if (reference.type === "entity-column") {
			return buildEntityColumnExpression({
				reference,
				targetType,
				alias: input.alias,
				context: input.context,
			});
		}

		if (reference.type === "schema-property") {
			return buildSchemaPropertyExpression({
				reference,
				targetType,
				alias: input.alias,
				context: input.context,
			});
		}

		if (reference.type === "event-join-column") {
			return buildEventJoinColumnExpression({
				reference,
				targetType,
				alias: input.alias,
			});
		}

		return buildEventJoinPropertyExpression({
			reference,
			targetType,
			alias: input.alias,
			context: input.context,
		});
	};

	return { compile, getTypeInfo };
};
