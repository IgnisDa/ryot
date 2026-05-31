import { isNotNull, sql } from "drizzle-orm";
import { Match } from "effect";

import type { QueryComputedField, QueryExpression } from "~/lib/query-language";
import { buildComputedFieldMap, getComputedFieldOrThrow } from "~/lib/views/computed-fields";
import {
	assertConcatCompatibleExpression,
	assertNumericExpression,
	type ViewExpressionTypeInfo,
} from "~/lib/views/expression-analysis";
import type { PropertyType } from "~/lib/views/reference";

import type { QueryEngineContext } from "./context";
import { buildEntityExpression, buildEntitySchemaExpression } from "./entity-reference-compilers";
import {
	buildEventAggregateExpression,
	buildEventExpression,
	buildEventJoinExpression,
	buildEventSchemaExpression,
} from "./event-reference-compilers";
import { buildPredicateClause } from "./predicate-clause-builder";
import { buildRelationshipJoinExpression } from "./relationship-reference-compilers";
import {
	buildCoalescedExpression,
	buildIntegerNormalizationExpression,
	buildJsonNullNormalizedExpression,
	buildLiteralExpression,
	buildTextValueExpression,
	type SqlExpression,
} from "./sql-expression-helpers";

type ReferenceResolver = (input: {
	reference: Extract<QueryExpression, { type: "reference" }>["reference"];
	targetType?: PropertyType;
	compile: CompiledExpression;
}) => SqlExpression;

type CompiledExpression = (expression: QueryExpression, targetType?: PropertyType) => SqlExpression;

export const createExpressionCompilerCore = (input: {
	resolveReference: ReferenceResolver;
	getTypeInfo: (expression: QueryExpression) => ViewExpressionTypeInfo;
}): ExpressionCompiler => {
	const { getTypeInfo } = input;

	const compile = (expression: QueryExpression, targetType?: PropertyType): SqlExpression => {
		return Match.value(expression).pipe(
			Match.when({ type: "literal" }, (expr) =>
				buildLiteralExpression({ literalType: undefined, value: expr.value }, targetType),
			),
			Match.when({ type: "isNotNull" }, (expr) => {
				const compiled = compile(expr.expression);
				return sql`(${isNotNull(compiled)})`;
			}),
			Match.when({ type: "coalesce" }, (expr) => {
				const typeInfo = getTypeInfo(expr);
				const coalesceTargetType =
					targetType ?? (typeInfo.kind === "property" ? typeInfo.propertyType : undefined);
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
			}),
			Match.when({ type: "arithmetic" }, (expr) => {
				const leftType = getTypeInfo(expr.left);
				const rightType = getTypeInfo(expr.right);
				assertNumericExpression(leftType, "Arithmetic");
				assertNumericExpression(rightType, "Arithmetic");
				const arithmeticTargetType =
					targetType ??
					(expr.operator === "divide" ||
					(leftType.kind === "property" && leftType.propertyType === "number") ||
					(rightType.kind === "property" && rightType.propertyType === "number")
						? "number"
						: "integer");
				const left = compile(expr.left, arithmeticTargetType);
				const right = compile(expr.right, arithmeticTargetType);

				return Match.value(expr.operator).pipe(
					Match.when("add", () => sql`(${left}) + (${right})`),
					Match.when("subtract", () => sql`(${left}) - (${right})`),
					Match.when("multiply", () => sql`(${left}) * (${right})`),
					Match.when("divide", () => sql`(${left}) / nullif((${right}), 0)`),
					Match.exhaustive,
				);
			}),
			Match.when({ type: "round" }, (expr) => {
				const expressionType = getTypeInfo(expr.expression);
				assertNumericExpression(expressionType, "Numeric normalization");
				const compiled = compile(expr.expression, "number");
				return sql`round(${compiled})::integer`;
			}),
			Match.when({ type: "floor" }, (expr) => {
				const expressionType = getTypeInfo(expr.expression);
				assertNumericExpression(expressionType, "Numeric normalization");
				const compiled = compile(expr.expression, "number");
				return sql`floor(${compiled})::integer`;
			}),
			Match.when({ type: "integer" }, (expr) => {
				const expressionType = getTypeInfo(expr.expression);
				assertNumericExpression(expressionType, "Numeric normalization");
				return buildIntegerNormalizationExpression(compile(expr.expression, "number"));
			}),
			Match.when({ type: "concat" }, (expr) => {
				for (const value of expr.values) {
					assertConcatCompatibleExpression(getTypeInfo(value));
				}

				return sql`concat(${sql.join(
					expr.values.map((value) => buildTextValueExpression(compile(value))),
					sql`, `,
				)})`;
			}),
			Match.when({ type: "transform" }, (expr) => {
				assertConcatCompatibleExpression(getTypeInfo(expr.expression));
				const textExpr = buildTextValueExpression(compile(expr.expression));

				return Match.value(expr.name).pipe(
					Match.when("titleCase", () =>
						sql`initcap(replace(replace(${textExpr}, '_', ' '), '-', ' '))`,
					),
					Match.when("kebabCase", () =>
						sql`lower(replace(replace(${textExpr}, '_', '-'), ' ', '-'))`,
					),
					Match.exhaustive,
				);
			}),
			Match.when({ type: "conditional" }, (expr) => {
				const typeInfo = getTypeInfo(expr);
				const conditionalTargetType =
					targetType ?? (typeInfo.kind === "property" ? typeInfo.propertyType : undefined);
				const predicate = buildPredicateClause({
					predicate: expr.condition,
					compiler: { compile, getTypeInfo },
				});
				const whenTrue = compile(expr.whenTrue, conditionalTargetType);
				const whenFalse = compile(expr.whenFalse, conditionalTargetType);
				return sql`case when ${predicate} then ${whenTrue} else ${whenFalse} end`;
			}),
			Match.when({ type: "reference" }, (expr) =>
				input.resolveReference({ compile, targetType, reference: expr.reference }),
			),
			Match.exhaustive,
		);
	};

	return { compile, getTypeInfo };
};

export const createScalarExpressionCompiler = (input: {
	alias: string;
	context: QueryEngineContext;
	computedFields?: ReadonlyArray<QueryComputedField>;
	getTypeInfo: (expression: QueryExpression) => ViewExpressionTypeInfo;
}): { compile: CompiledExpression } => {
	const computedFieldMap = buildComputedFieldMap(input.computedFields);
	const expressionCache = new Map<string, SqlExpression>();
	const { compile } = createExpressionCompilerCore({
		getTypeInfo: input.getTypeInfo,
		resolveReference: ({ compile: compileExpression, reference, targetType }) =>
			Match.value(reference).pipe(
				Match.when({ type: "computed-field" }, (ref) => {
					const cacheKey = `${ref.key}:${targetType ?? "base"}`;
					const cached = expressionCache.get(cacheKey);
					if (cached) {
						return cached;
					}

					const computedField = getComputedFieldOrThrow(computedFieldMap, ref.key);
					const compiled = compileExpression(computedField.expression, targetType);
					expressionCache.set(cacheKey, compiled);
					return compiled;
				}),
				Match.when({ type: "entity" }, (ref) =>
					buildEntityExpression({
						targetType,
						reference: ref,
						alias: input.alias,
						context: input.context,
					}),
				),
				Match.when({ type: "entity-schema" }, (ref) =>
					buildEntitySchemaExpression({ targetType, reference: ref, alias: input.alias }),
				),
				Match.when({ type: "event-aggregate" }, (ref) =>
					buildEventAggregateExpression({
						targetType,
						reference: ref,
						alias: input.alias,
						context: input.context,
					}),
				),
				Match.when({ type: "event-join" }, (ref) =>
					buildEventJoinExpression({
						targetType,
						reference: ref,
						alias: input.alias,
						context: input.context,
					}),
				),
				Match.when({ type: "relationship-join" }, (ref) =>
					buildRelationshipJoinExpression({
						targetType,
						reference: ref,
						alias: input.alias,
						context: input.context,
					}),
				),
				Match.when({ type: "event" }, (ref) =>
					buildEventExpression({
						targetType,
						reference: ref,
						alias: input.alias,
						context: input.context,
					}),
				),
				Match.when({ type: "event-schema" }, (ref) =>
					buildEventSchemaExpression({ targetType, reference: ref, alias: input.alias }),
				),
				Match.exhaustive,
			),
	});

	return { compile };
};

export type ExpressionCompiler = {
	compile: CompiledExpression;
	getTypeInfo: (expression: QueryExpression) => ViewExpressionTypeInfo;
};

export const createQueryCompiler = (input: {
	alias: string;
	context: QueryEngineContext;
	computedFields?: ReadonlyArray<QueryComputedField>;
	getTypeInfo: (expression: QueryExpression) => ViewExpressionTypeInfo;
}): ExpressionCompiler => {
	const { compile } = createScalarExpressionCompiler({
		alias: input.alias,
		context: input.context,
		getTypeInfo: input.getTypeInfo,
		computedFields: input.computedFields,
	});
	return { compile, getTypeInfo: input.getTypeInfo };
};
