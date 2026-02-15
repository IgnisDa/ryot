import { sql } from "drizzle-orm";
import { match } from "ts-pattern";
import {
	buildComputedFieldMap,
	getComputedFieldOrThrow,
} from "~/lib/views/computed-fields";
import { QueryEngineValidationError } from "~/lib/views/errors";
import type { ViewComputedField, ViewExpression } from "~/lib/views/expression";
import {
	assertConcatCompatibleExpression,
	assertNumericExpression,
	type ViewExpressionTypeInfo,
} from "~/lib/views/expression-analysis";
import type {
	PropertyType,
	QueryEngineEventJoinLike,
	QueryEngineReferenceContext,
	QueryEngineSchemaLike,
} from "~/lib/views/reference";
import { buildPredicateClause } from "./predicate-clause-builder";
import {
	buildEntityExpression,
	buildEntitySchemaExpression,
	buildEventAggregateExpression,
	buildEventExpression,
	buildEventJoinExpression,
	buildEventSchemaExpression,
} from "./reference-compilers";
import {
	buildCoalescedExpression,
	buildIntegerNormalizationExpression,
	buildJsonNullNormalizedExpression,
	buildLiteralExpression,
	buildTextValueExpression,
	type SqlExpression,
} from "./sql-expression-helpers";

export const createScalarExpressionCompiler = <
	TSchema extends QueryEngineSchemaLike,
	TJoin extends QueryEngineEventJoinLike,
>(input: {
	alias: string;
	computedFields?: ViewComputedField[];
	context: QueryEngineReferenceContext<TSchema, TJoin>;
	getTypeInfo: (expression: ViewExpression) => ViewExpressionTypeInfo;
}) => {
	const computedFieldMap = buildComputedFieldMap(input.computedFields);
	const expressionCache = new Map<string, SqlExpression>();
	const { getTypeInfo } = input;

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

	return { compile };
};
