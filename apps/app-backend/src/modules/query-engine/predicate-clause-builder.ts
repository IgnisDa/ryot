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
import { match } from "ts-pattern";

import { QueryEngineValidationError } from "~/lib/views/errors";
import {
	assertContainsCompatibleExpression,
	normalizeExpressionPropertyType,
	type ViewExpressionTypeInfo,
} from "~/lib/views/expression-analysis";
import type { ViewPredicate } from "~/lib/views/filtering";

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
	predicate: Extract<ViewPredicate, { type: "contains" }>;
}): SqlExpression => {
	const expressionType = input.compiler.getTypeInfo(input.predicate.expression);
	assertContainsCompatibleExpression(expressionType);
	if (expressionType.kind !== "property") {
		throw new QueryEngineValidationError(
			"Filter operator 'contains' requires a property expression",
		);
	}

	return match(expressionType.propertyType)
		.with("string", () => {
			const expression = input.compiler.compile(input.predicate.expression, "string");
			const value = input.compiler.compile(input.predicate.value, "string");
			return sql`${expression} ilike ${buildEscapedContainsPattern(value)} escape '\\'`;
		})
		.with("array", () => {
			const expression = input.compiler.compile(input.predicate.expression, "array");
			const valueType = input.compiler.getTypeInfo(input.predicate.value);
			const value = input.compiler.compile(input.predicate.value);
			return sql`${expression} @> jsonb_build_array(${valueType.kind === "property" && ["array", "object"].includes(valueType.propertyType) ? value : toJsonbExpression(value)})`;
		})
		.with("object", () => {
			const expression = input.compiler.compile(input.predicate.expression, "object");
			const value = toJsonbExpression(input.compiler.compile(input.predicate.value));
			return sql`${expression} @> ${value}`;
		})
		.otherwise(() => {
			throw new QueryEngineValidationError(
				`Filter operator 'contains' is not supported for expression type '${expressionType.propertyType}'`,
			);
		});
};

export const buildPredicateClause = (input: {
	predicate: ViewPredicate;
	compiler: ExpressionCompiler;
}): SqlExpression => {
	const { compiler } = input;

	return match(input.predicate)
		.with({ type: "and" }, (predicate) => {
			const [first, ...rest] = predicate.predicates.map((p) =>
				buildPredicateClause({ predicate: p, compiler }),
			);
			if (!first) {
				throw new QueryEngineValidationError("And predicates must not be empty");
			}
			return rest.length ? (and(first, ...rest) ?? first) : first;
		})
		.with({ type: "or" }, (predicate) => {
			const [first, ...rest] = predicate.predicates.map((p) =>
				buildPredicateClause({ predicate: p, compiler }),
			);
			if (!first) {
				throw new QueryEngineValidationError("Or predicates must not be empty");
			}
			return rest.length ? (or(first, ...rest) ?? first) : first;
		})
		.with({ type: "not" }, (predicate) =>
			not(buildPredicateClause({ predicate: predicate.predicate, compiler })),
		)
		.with({ type: "isNull" }, (predicate) =>
			isNull(
				normalizeJsonNullForNullChecks({
					expression: compiler.compile(predicate.expression),
					typeInfo: compiler.getTypeInfo(predicate.expression),
				}),
			),
		)
		.with({ type: "isNotNull" }, (predicate) =>
			isNotNull(
				normalizeJsonNullForNullChecks({
					expression: compiler.compile(predicate.expression),
					typeInfo: compiler.getTypeInfo(predicate.expression),
				}),
			),
		)
		.with({ type: "comparison" }, (predicate) => {
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

			return match(predicate.operator)
				.with("eq", () => eq(left, right))
				.with("gt", () => gt(left, right))
				.with("lt", () => lt(left, right))
				.with("neq", () => ne(left, right))
				.with("gte", () => gte(left, right))
				.with("lte", () => lte(left, right))
				.exhaustive();
		})
		.with({ type: "in" }, (predicate) => {
			const expressionType = compiler.getTypeInfo(predicate.expression);
			const targetType =
				expressionType.kind === "property"
					? normalizeExpressionPropertyType(expressionType.propertyType)
					: undefined;
			const expression = compiler.compile(predicate.expression, targetType);
			const values = predicate.values.map((value) => compiler.compile(value, targetType));
			return inArray(expression, values);
		})
		.with({ type: "contains" }, (predicate) => buildContainsClause({ predicate, compiler }))
		.exhaustive();
};
