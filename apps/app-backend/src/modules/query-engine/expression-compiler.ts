import { sql } from "drizzle-orm";
import { match } from "ts-pattern";
import {
	buildComputedFieldMap,
	getComputedFieldOrThrow,
} from "~/lib/views/computed-fields";
import type { ViewComputedField, ViewExpression } from "~/lib/views/expression";
import {
	assertConcatCompatibleExpression,
	assertNumericExpression,
	type ViewExpressionTypeInfo,
} from "~/lib/views/expression-analysis";
import type { PropertyType } from "~/lib/views/reference";
import { buildPredicateClause } from "./predicate-clause-builder";
import {
	buildEntityExpression,
	buildEntitySchemaExpression,
	buildEventAggregateExpression,
	buildEventExpression,
	buildEventJoinExpression,
	buildEventSchemaExpression,
} from "./reference-compilers";
import type { QueryEngineContext } from "./schemas";
import {
	buildCoalescedExpression,
	buildIntegerNormalizationExpression,
	buildJsonNullNormalizedExpression,
	buildLiteralExpression,
	buildTextValueExpression,
	type SqlExpression,
} from "./sql-expression-helpers";

export const createScalarExpressionCompiler = (input: {
	alias: string;
	context: QueryEngineContext;
	computedFields?: ViewComputedField[];
	getTypeInfo: (expression: ViewExpression) => ViewExpressionTypeInfo;
}) => {
	const computedFieldMap = buildComputedFieldMap(input.computedFields);
	const expressionCache = new Map<string, SqlExpression>();
	const { getTypeInfo } = input;

	const compile = (
		expression: ViewExpression,
		targetType?: PropertyType,
	): SqlExpression => {
		return match(expression)
			.with({ type: "literal" }, (expr) =>
				buildLiteralExpression(expr.value, targetType),
			)
			.with({ type: "coalesce" }, (expr) => {
				const typeInfo = getTypeInfo(expr);
				const coalesceTargetType =
					targetType ??
					(typeInfo.kind === "property" ? typeInfo.propertyType : undefined);
				return buildCoalescedExpression(
					expr.values.map((value) => {
						const compiledValue = compile(value, coalesceTargetType);
						return buildJsonNullNormalizedExpression({
							expression: compiledValue,
							targetType: coalesceTargetType,
							typeInfo: getTypeInfo(value),
						});
					}),
				);
			})
			.with({ type: "arithmetic" }, (expr) => {
				const leftType = getTypeInfo(expr.left);
				const rightType = getTypeInfo(expr.right);
				assertNumericExpression(leftType, "Arithmetic");
				assertNumericExpression(rightType, "Arithmetic");
				const arithmeticTargetType =
					targetType ??
					(expr.operator === "divide" ||
					(leftType.kind === "property" &&
						leftType.propertyType === "number") ||
					(rightType.kind === "property" && rightType.propertyType === "number")
						? "number"
						: "integer");
				const left = compile(expr.left, arithmeticTargetType);
				const right = compile(expr.right, arithmeticTargetType);

				return match(expr.operator)
					.with("add", () => sql`(${left}) + (${right})`)
					.with("subtract", () => sql`(${left}) - (${right})`)
					.with("multiply", () => sql`(${left}) * (${right})`)
					.with("divide", () => sql`(${left}) / nullif((${right}), 0)`)
					.exhaustive();
			})
			.with({ type: "round" }, (expr) => {
				const expressionType = getTypeInfo(expr.expression);
				assertNumericExpression(expressionType, "Numeric normalization");
				const compiled = compile(expr.expression, "number");
				return sql`round(${compiled})::integer`;
			})
			.with({ type: "floor" }, (expr) => {
				const expressionType = getTypeInfo(expr.expression);
				assertNumericExpression(expressionType, "Numeric normalization");
				const compiled = compile(expr.expression, "number");
				return sql`floor(${compiled})::integer`;
			})
			.with({ type: "integer" }, (expr) => {
				const expressionType = getTypeInfo(expr.expression);
				assertNumericExpression(expressionType, "Numeric normalization");
				return buildIntegerNormalizationExpression(
					compile(expr.expression, "number"),
				);
			})
			.with({ type: "concat" }, (expr) => {
				for (const value of expr.values) {
					assertConcatCompatibleExpression(getTypeInfo(value));
				}

				return sql`concat(${sql.join(
					expr.values.map((value) => buildTextValueExpression(compile(value))),
					sql`, `,
				)})`;
			})
			.with({ type: "transform" }, (expr) => {
				assertConcatCompatibleExpression(getTypeInfo(expr.expression));
				const textExpr = buildTextValueExpression(compile(expr.expression));

				return match(expr.name)
					.with(
						"titleCase",
						() =>
							sql`initcap(replace(replace(${textExpr}, '_', ' '), '-', ' '))`,
					)
					.with(
						"kebabCase",
						() => sql`lower(replace(replace(${textExpr}, '_', '-'), ' ', '-'))`,
					)
					.exhaustive();
			})
			.with({ type: "conditional" }, (expr) => {
				const typeInfo = getTypeInfo(expr);
				const conditionalTargetType =
					targetType ??
					(typeInfo.kind === "property" ? typeInfo.propertyType : undefined);
				const predicate = buildPredicateClause({
					predicate: expr.condition,
					compiler: { compile, getTypeInfo },
				});
				const whenTrue = compile(expr.whenTrue, conditionalTargetType);
				const whenFalse = compile(expr.whenFalse, conditionalTargetType);
				return sql`case when ${predicate} then ${whenTrue} else ${whenFalse} end`;
			})
			.with({ type: "reference" }, (expr) =>
				match(expr.reference)
					.with({ type: "computed-field" }, (ref) => {
						const cacheKey = `${ref.key}:${targetType ?? "base"}`;
						const cached = expressionCache.get(cacheKey);
						if (cached) {
							return cached;
						}

						const computedField = getComputedFieldOrThrow(
							computedFieldMap,
							ref.key,
						);

						const compiled = compile(computedField.expression, targetType);
						expressionCache.set(cacheKey, compiled);
						return compiled;
					})
					.with({ type: "entity" }, (ref) =>
						buildEntityExpression({
							targetType,
							reference: ref,
							alias: input.alias,
							context: input.context,
						}),
					)
					.with({ type: "entity-schema" }, (ref) =>
						buildEntitySchemaExpression({
							targetType,
							reference: ref,
							alias: input.alias,
						}),
					)
					.with({ type: "event-aggregate" }, (ref) =>
						buildEventAggregateExpression({
							targetType,
							reference: ref,
							alias: input.alias,
							context: input.context,
						}),
					)
					.with({ type: "event-join" }, (ref) =>
						buildEventJoinExpression({
							targetType,
							reference: ref,
							alias: input.alias,
							context: input.context,
						}),
					)
					.with({ type: "event" }, (ref) =>
						buildEventExpression({
							targetType,
							reference: ref,
							alias: input.alias,
							context: input.context,
						}),
					)
					.with({ type: "event-schema" }, (ref) =>
						buildEventSchemaExpression({
							targetType,
							reference: ref,
							alias: input.alias,
						}),
					)
					.exhaustive(),
			)
			.exhaustive();
	};

	return { compile };
};

export type ExpressionCompiler = {
	compile: ReturnType<typeof createScalarExpressionCompiler>["compile"];
	getTypeInfo: (expression: ViewExpression) => ViewExpressionTypeInfo;
};
