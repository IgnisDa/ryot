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
	not,
	or,
	sql,
} from "drizzle-orm";
import { Match } from "effect";

import type { QueryFilter } from "#lib/query-language";
import { QueryEngineValidationError } from "#lib/views/errors";
import {
	assertContainsCompatibleExpression,
	normalizeExpressionPropertyType,
	type ViewExpressionTypeInfo,
} from "#lib/views/expression-analysis";

import type { ExpressionCompiler } from "./expression-compiler";
import type { SqlExpression } from "./sql-expression-helpers";

const toJsonbExpression = (expression: SqlExpression) => sql`to_jsonb(${expression})`;

const buildEscapedContainsPattern = (expression: SqlExpression) => {
	const textExpression = sql`(${expression})::text`;
	const escapedBackslashes = sql`replace(${textExpression}, '\\', '\\\\')`;
	const escapedPercents = sql`replace(${escapedBackslashes}, '%', '\\%')`;
	const escapedUnderscores = sql`replace(${escapedPercents}, '_', '\\_')`;
	return sql`'%' || ${escapedUnderscores} || '%'`;
};

const normalizeJsonNullForNullChecks = (input: {
	expression: SqlExpression;
	typeInfo: ViewExpressionTypeInfo;
}) => {
	return input.typeInfo.kind === "property" &&
		["array", "object"].includes(normalizeExpressionPropertyType(input.typeInfo.propertyType))
		? sql`nullif(${input.expression}, 'null'::jsonb)`
		: input.expression;
};

const buildContainsClause = (input: {
	compiler: ExpressionCompiler;
	predicate: Extract<QueryFilter, { type: "contains" }>;
}): SqlExpression => {
	const expressionType = input.compiler.getTypeInfo(input.predicate.expression);
	assertContainsCompatibleExpression(expressionType);
	if (expressionType.kind !== "property") {
		throw new QueryEngineValidationError(
			"Filter operator 'contains' requires a property expression",
		);
	}

	return Match.value(expressionType.propertyType).pipe(
		Match.when("string", () => {
			const expression = input.compiler.compile(input.predicate.expression, "string");
			const value = input.compiler.compile(input.predicate.value, "string");
			return sql`${expression} ilike ${buildEscapedContainsPattern(value)} escape '\\'`;
		}),
		Match.when("array", () => {
			const expression = input.compiler.compile(input.predicate.expression, "array");
			const valueType = input.compiler.getTypeInfo(input.predicate.value);
			const value = input.compiler.compile(input.predicate.value);
			return sql`${expression} @> jsonb_build_array(${valueType.kind === "property" && ["array", "object"].includes(valueType.propertyType) ? value : toJsonbExpression(value)})`;
		}),
		Match.when("object", () => {
			const expression = input.compiler.compile(input.predicate.expression, "object");
			const value = toJsonbExpression(input.compiler.compile(input.predicate.value));
			return sql`${expression} @> ${value}`;
		}),
		Match.orElse(() => {
			throw new QueryEngineValidationError(
				`Filter operator 'contains' is not supported for expression type '${expressionType.propertyType}'`,
			);
		}),
	);
};

export const buildPredicateClause = (input: {
	predicate: QueryFilter;
	compiler: ExpressionCompiler;
}): SqlExpression => {
	const { compiler } = input;

	return Match.value(input.predicate).pipe(
		Match.when({ type: "and" }, (predicate) => {
			const [first, ...rest] = predicate.predicates.map((p) =>
				buildPredicateClause({ predicate: p, compiler }),
			);
			if (!first) {
				throw new QueryEngineValidationError("And predicates must not be empty");
			}
			return rest.length ? (and(first, ...rest) ?? first) : first;
		}),
		Match.when({ type: "or" }, (predicate) => {
			const [first, ...rest] = predicate.predicates.map((p) =>
				buildPredicateClause({ predicate: p, compiler }),
			);
			if (!first) {
				throw new QueryEngineValidationError("Or predicates must not be empty");
			}
			return rest.length ? (or(first, ...rest) ?? first) : first;
		}),
		Match.when({ type: "not" }, (predicate) =>
			not(buildPredicateClause({ predicate: predicate.predicate, compiler })),
		),
		Match.when({ type: "isNull" }, (predicate) =>
			isNull(
				normalizeJsonNullForNullChecks({
					expression: compiler.compile(predicate.expression),
					typeInfo: compiler.getTypeInfo(predicate.expression),
				}),
			),
		),
		Match.when({ type: "isNotNull" }, (predicate) =>
			isNotNull(
				normalizeJsonNullForNullChecks({
					expression: compiler.compile(predicate.expression),
					typeInfo: compiler.getTypeInfo(predicate.expression),
				}),
			),
		),
		Match.when({ type: "comparison" }, (predicate) => {
			const leftType = compiler.getTypeInfo(predicate.left);
			const rightType = compiler.getTypeInfo(predicate.right);
			const targetType =
				leftType.kind === "property"
					? normalizeExpressionPropertyType(leftType.propertyType)
					: rightType.kind === "property"
						? normalizeExpressionPropertyType(rightType.propertyType)
						: undefined;
			const left = compiler.compile(predicate.left, targetType);
			const right = compiler.compile(predicate.right, targetType);

			return Match.value(predicate.operator).pipe(
				Match.when("eq", () => eq(left, right)),
				Match.when("gt", () => gt(left, right)),
				Match.when("lt", () => lt(left, right)),
				Match.when("neq", () => ne(left, right)),
				Match.when("gte", () => gte(left, right)),
				Match.when("lte", () => lte(left, right)),
				Match.exhaustive,
			);
		}),
		Match.when({ type: "in" }, (predicate) => {
			const expressionType = compiler.getTypeInfo(predicate.expression);
			const targetType =
				expressionType.kind === "property"
					? normalizeExpressionPropertyType(expressionType.propertyType)
					: undefined;
			const expression = compiler.compile(predicate.expression, targetType);
			const values = predicate.values.map((value) => compiler.compile(value, targetType));
			return inArray(expression, values);
		}),
		Match.when({ type: "contains" }, (predicate) => buildContainsClause({ predicate, compiler })),
		Match.exhaustive,
	);
};
