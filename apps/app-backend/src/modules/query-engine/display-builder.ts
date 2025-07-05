import { sql } from "drizzle-orm";
import {
	getComputedFieldOrThrow,
	prepareComputedFields,
} from "~/lib/views/computed-fields";
import type { ViewComputedField, ViewExpression } from "~/lib/views/expression";
import {
	normalizeExpressionPropertyType,
	type ViewExpressionTypeInfo,
} from "~/lib/views/expression-analysis";
import { getPropertyDisplayKind } from "~/lib/views/policy";
import type {
	QueryEngineEventJoinLike,
	QueryEngineReferenceContext,
	QueryEngineSchemaLike,
} from "~/lib/views/reference";
import { createScalarExpressionCompiler } from "./expression-compiler";
import type { QueryEngineField, ResolvedDisplayValue } from "./schemas";
import type { SqlExpression } from "./sql-expression-helpers";

type DisplayExpressionResolverInput<
	TSchema extends QueryEngineSchemaLike,
	TJoin extends QueryEngineEventJoinLike,
> = {
	alias: string;
	computedFields?: ViewComputedField[];
	context: QueryEngineReferenceContext<TSchema, TJoin>;
};

const buildResolvedDisplayValueObject = (input: {
	value: SqlExpression;
	kind: ResolvedDisplayValue["kind"];
}) => {
	return sql`jsonb_build_object('value', ${input.value}, 'kind', ${sql.raw(`'${input.kind}'::text`)})`;
};

const buildNullResolvedDisplayValueObject = () => {
	return buildResolvedDisplayValueObject({ kind: "null", value: sql`null` });
};

const normalizeJsonbNull = (expression: SqlExpression) => {
	return sql`nullif(${expression}, 'null'::jsonb)`;
};

const buildLiteralValueExpression = (value: unknown | null) => {
	if (value === null) {
		return sql`null`;
	}

	return sql`${JSON.stringify(value)}::jsonb`;
};

const getLiteralDisplayKind = (
	value: unknown | null,
): ResolvedDisplayValue["kind"] => {
	if (value === null) {
		return "null";
	}

	if (typeof value === "string") {
		return "text";
	}

	if (typeof value === "number") {
		return "number";
	}

	if (typeof value === "boolean") {
		return "boolean";
	}

	return "json";
};

const getExpressionDisplayKind = (
	typeInfo: ViewExpressionTypeInfo,
): ResolvedDisplayValue["kind"] => {
	if (typeInfo.kind === "null") {
		return "null";
	}

	if (typeInfo.kind === "image") {
		return "image";
	}

	return getPropertyDisplayKind(typeInfo.propertyType);
};

const toDisplayJsonValue = (input: {
	expression: SqlExpression;
	typeInfo: ViewExpressionTypeInfo;
}) => {
	if (input.typeInfo.kind === "null") {
		return sql`null`;
	}

	if (input.typeInfo.kind === "image") {
		return input.expression;
	}

	const propertyType = normalizeExpressionPropertyType(
		input.typeInfo.propertyType,
	);

	if (["array", "object"].includes(propertyType)) {
		return normalizeJsonbNull(input.expression);
	}

	if (propertyType === "date") {
		return sql`to_jsonb(to_char(${input.expression} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS3"Z"'))`;
	}

	return sql`to_jsonb(${input.expression})`;
};

const createDisplayExpressionResolver = <
	TSchema extends QueryEngineSchemaLike,
	TJoin extends QueryEngineEventJoinLike,
>(
	input: DisplayExpressionResolverInput<TSchema, TJoin>,
) => {
	const computedFieldCache = new Map<string, SqlExpression>();
	const { computedFieldMap, orderedComputedFields } = prepareComputedFields(
		input.computedFields,
	);
	const scalarCompiler = createScalarExpressionCompiler({
		alias: input.alias,
		context: input.context,
		computedFields: input.computedFields,
	});

	const buildResolvedDisplayValueExpression = (
		expression: ViewExpression,
	): SqlExpression => {
		if (expression.type === "literal") {
			return buildResolvedDisplayValueObject({
				kind: getLiteralDisplayKind(expression.value),
				value: buildLiteralValueExpression(expression.value),
			});
		}

		if (
			expression.type === "reference" &&
			expression.reference.type === "computed-field"
		) {
			const computedField = getComputedFieldOrThrow(
				computedFieldMap,
				expression.reference.key,
			);

			const cached = computedFieldCache.get(expression.reference.key);
			if (cached) {
				return cached;
			}

			const resolved = buildResolvedDisplayValueExpression(
				computedField.expression,
			);
			computedFieldCache.set(expression.reference.key, resolved);
			return resolved;
		}

		const typeInfo = scalarCompiler.getTypeInfo(expression);
		if (typeInfo.kind === "null") {
			return buildNullResolvedDisplayValueObject();
		}

		const compiled = scalarCompiler.compile(
			expression,
			typeInfo.kind === "property" ? typeInfo.propertyType : undefined,
		);
		const value = toDisplayJsonValue({ expression: compiled, typeInfo });
		const resolved = buildResolvedDisplayValueObject({
			value,
			kind: getExpressionDisplayKind(typeInfo),
		});

		return sql`case when ${value} is not null then ${resolved} else ${buildNullResolvedDisplayValueObject()} end`;
	};

	for (const computedField of orderedComputedFields) {
		if (!computedFieldCache.has(computedField.key)) {
			computedFieldCache.set(
				computedField.key,
				buildResolvedDisplayValueExpression(computedField.expression),
			);
		}
	}

	return buildResolvedDisplayValueExpression;
};

export const buildResolvedFieldsExpression = <
	TSchema extends QueryEngineSchemaLike,
	TJoin extends QueryEngineEventJoinLike,
>(input: {
	alias: string;
	fields: QueryEngineField[];
	computedFields?: ViewComputedField[];
	context: QueryEngineReferenceContext<TSchema, TJoin>;
}) => {
	const resolveExpression = createDisplayExpressionResolver({
		alias: input.alias,
		context: input.context,
		computedFields: input.computedFields,
	});

	const fieldExpressions = input.fields.map((field) => {
		const resolvedValue = resolveExpression(field.expression);

		return sql`jsonb_build_object(
			'key', cast(${field.key} as text),
			'kind', ${resolvedValue} ->> 'kind',
			'value', ${resolvedValue} -> 'value'
		)`;
	});

	if (!fieldExpressions.length) {
		return sql`'[]'::jsonb`;
	}

	return sql`jsonb_build_array(${sql.join(fieldExpressions, sql`, `)})`;
};
