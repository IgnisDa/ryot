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
import type { ViewExpression } from "~/lib/views/expression";
import {
	assertContainsCompatibleExpression,
	normalizeExpressionPropertyType,
	type ViewExpressionTypeInfo,
} from "~/lib/views/expression-analysis";
import type { ViewPredicate } from "~/lib/views/filtering";
import type { PropertyType } from "~/lib/views/reference";
import type { SqlExpression } from "./sql-expression-helpers";

const toJsonbExpression = (expression: SqlExpression) =>
	sql`to_jsonb(${expression})`;

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
		["array", "object"].includes(
			normalizeExpressionPropertyType(input.typeInfo.propertyType),
		)
		? sql`nullif(${input.expression}, 'null'::jsonb)`
		: input.expression;
};

type PredicateExpressionCompiler = {
	compile: (
		expression: ViewExpression,
		targetType?: PropertyType,
	) => SqlExpression;
	getTypeInfo: (expression: ViewExpression) => ViewExpressionTypeInfo;
};

export const buildPredicateClause = (input: {
	predicate: ViewPredicate;
	compiler: PredicateExpressionCompiler;
}): SqlExpression => {
	const compiler = input.compiler;

	if (input.predicate.type === "and") {
		const [first, ...rest] = input.predicate.predicates.map((predicate) =>
			buildPredicateClause({ predicate, compiler }),
		);
		if (!first) {
			throw new QueryEngineValidationError("And predicates must not be empty");
		}

		return rest.length ? (and(first, ...rest) ?? first) : first;
	}

	if (input.predicate.type === "or") {
		const [first, ...rest] = input.predicate.predicates.map((predicate) =>
			buildPredicateClause({ predicate, compiler }),
		);
		if (!first) {
			throw new QueryEngineValidationError("Or predicates must not be empty");
		}

		return rest.length ? (or(first, ...rest) ?? first) : first;
	}

	if (input.predicate.type === "not") {
		return not(
			buildPredicateClause({
				predicate: input.predicate.predicate,
				compiler,
			}),
		);
	}

	if (input.predicate.type === "isNull") {
		return isNull(
			normalizeJsonNullForNullChecks({
				expression: compiler.compile(input.predicate.expression),
				typeInfo: compiler.getTypeInfo(input.predicate.expression),
			}),
		);
	}

	if (input.predicate.type === "isNotNull") {
		return isNotNull(
			normalizeJsonNullForNullChecks({
				expression: compiler.compile(input.predicate.expression),
				typeInfo: compiler.getTypeInfo(input.predicate.expression),
			}),
		);
	}

	if (input.predicate.type === "comparison") {
		const leftType = compiler.getTypeInfo(input.predicate.left);
		const rightType = compiler.getTypeInfo(input.predicate.right);
		const targetType =
			leftType.kind === "property"
				? normalizeExpressionPropertyType(leftType.propertyType)
				: rightType.kind === "property"
					? normalizeExpressionPropertyType(rightType.propertyType)
					: undefined;
		const left = compiler.compile(input.predicate.left, targetType);
		const right = compiler.compile(input.predicate.right, targetType);

		return match(input.predicate.operator)
			.with("eq", () => eq(left, right))
			.with("gt", () => gt(left, right))
			.with("lt", () => lt(left, right))
			.with("neq", () => ne(left, right))
			.with("gte", () => gte(left, right))
			.with("lte", () => lte(left, right))
			.exhaustive();
	}

	if (input.predicate.type === "in") {
		const expressionType = compiler.getTypeInfo(input.predicate.expression);
		const targetType =
			expressionType.kind === "property"
				? normalizeExpressionPropertyType(expressionType.propertyType)
				: undefined;
		const expression = compiler.compile(input.predicate.expression, targetType);
		const values = input.predicate.values.map((value) =>
			compiler.compile(value, targetType),
		);
		return inArray(expression, values);
	}

	const expressionType = compiler.getTypeInfo(input.predicate.expression);
	assertContainsCompatibleExpression(expressionType);
	if (expressionType.kind !== "property") {
		throw new QueryEngineValidationError(
			"Filter operator 'contains' requires a property expression",
		);
	}

	if (expressionType.propertyType === "string") {
		const expression = compiler.compile(input.predicate.expression, "string");
		const value = compiler.compile(input.predicate.value, "string");
		return sql`${expression} ilike ${buildEscapedContainsPattern(value)} escape '\\'`;
	}

	if (expressionType.propertyType === "array") {
		const expression = compiler.compile(input.predicate.expression, "array");
		const valueType = compiler.getTypeInfo(input.predicate.value);
		const value = compiler.compile(input.predicate.value);
		return sql`${expression} @> jsonb_build_array(${valueType.kind === "property" && ["array", "object"].includes(valueType.propertyType) ? value : toJsonbExpression(value)})`;
	}

	if (expressionType.propertyType === "object") {
		const expression = compiler.compile(input.predicate.expression, "object");
		const value = toJsonbExpression(compiler.compile(input.predicate.value));
		return sql`${expression} @> ${value}`;
	}

	throw new QueryEngineValidationError(
		`Filter operator 'contains' is not supported for expression type '${expressionType.propertyType}'`,
	);
};
