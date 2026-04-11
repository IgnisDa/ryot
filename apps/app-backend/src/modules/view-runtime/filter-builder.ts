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
import { ViewRuntimeValidationError } from "~/lib/views/errors";
import type { ViewComputedField } from "~/lib/views/expression";
import {
	assertContainsCompatibleExpression,
	normalizeExpressionPropertyType,
} from "~/lib/views/expression-analysis";
import type { ViewPredicate } from "~/lib/views/filtering";
import type {
	ViewRuntimeEventJoinLike,
	ViewRuntimeReferenceContext,
	ViewRuntimeSchemaLike,
} from "~/lib/views/reference";
import { createScalarExpressionCompiler } from "./expression-compiler";
import type { SqlExpression } from "./sql-expression-policy";

const toJsonbExpression = (expression: SqlExpression) =>
	sql`to_jsonb(${expression})`;

const buildEscapedContainsPattern = (expression: SqlExpression) => {
	const textExpression = sql`(${expression})::text`;
	const escapedBackslashes = sql`replace(${textExpression}, '\\', '\\\\')`;
	const escapedPercents = sql`replace(${escapedBackslashes}, '%', '\\%')`;
	const escapedUnderscores = sql`replace(${escapedPercents}, '_', '\\_')`;
	return sql`'%' || ${escapedUnderscores} || '%'`;
};

const buildPredicateClause = <
	TSchema extends ViewRuntimeSchemaLike,
	TJoin extends ViewRuntimeEventJoinLike,
>(input: {
	predicate: ViewPredicate;
	compiler: ReturnType<typeof createScalarExpressionCompiler<TSchema, TJoin>>;
}): SqlExpression => {
	if (input.predicate.type === "and") {
		const [first, ...rest] = input.predicate.predicates.map((predicate) =>
			buildPredicateClause({ predicate, compiler: input.compiler }),
		);
		if (!first) {
			throw new ViewRuntimeValidationError("And predicates must not be empty");
		}

		if (!rest.length) {
			return first;
		}

		return and(first, ...rest) ?? first;
	}

	if (input.predicate.type === "or") {
		const [first, ...rest] = input.predicate.predicates.map((predicate) =>
			buildPredicateClause({ predicate, compiler: input.compiler }),
		);
		if (!first) {
			throw new ViewRuntimeValidationError("Or predicates must not be empty");
		}

		if (!rest.length) {
			return first;
		}

		return or(first, ...rest) ?? first;
	}

	if (input.predicate.type === "not") {
		return not(
			buildPredicateClause({
				predicate: input.predicate.predicate,
				compiler: input.compiler,
			}),
		);
	}

	if (input.predicate.type === "isNull") {
		return isNull(input.compiler.compile(input.predicate.expression));
	}

	if (input.predicate.type === "isNotNull") {
		return isNotNull(input.compiler.compile(input.predicate.expression));
	}

	if (input.predicate.type === "comparison") {
		const leftType = input.compiler.getTypeInfo(input.predicate.left);
		const rightType = input.compiler.getTypeInfo(input.predicate.right);
		const targetType =
			leftType.kind === "property"
				? normalizeExpressionPropertyType(leftType.propertyType)
				: rightType.kind === "property"
					? normalizeExpressionPropertyType(rightType.propertyType)
					: undefined;
		const left = input.compiler.compile(input.predicate.left, targetType);
		const right = input.compiler.compile(input.predicate.right, targetType);

		return match(input.predicate.operator)
			.with("eq", () => eq(left, right))
			.with("neq", () => ne(left, right))
			.with("gt", () => gt(left, right))
			.with("gte", () => gte(left, right))
			.with("lt", () => lt(left, right))
			.with("lte", () => lte(left, right))
			.exhaustive();
	}

	if (input.predicate.type === "in") {
		const expressionType = input.compiler.getTypeInfo(
			input.predicate.expression,
		);
		const targetType =
			expressionType.kind === "property"
				? normalizeExpressionPropertyType(expressionType.propertyType)
				: undefined;
		const expression = input.compiler.compile(
			input.predicate.expression,
			targetType,
		);
		const values = input.predicate.values.map((value) =>
			input.compiler.compile(value, targetType),
		);
		return inArray(expression, values);
	}

	const expressionType = input.compiler.getTypeInfo(input.predicate.expression);
	assertContainsCompatibleExpression(expressionType);

	if (expressionType.kind !== "property") {
		throw new ViewRuntimeValidationError(
			"Filter operator 'contains' requires a property expression",
		);
	}

	if (expressionType.propertyType === "string") {
		const expression = input.compiler.compile(
			input.predicate.expression,
			"string",
		);
		const value = input.compiler.compile(input.predicate.value, "string");
		return sql`${expression} ilike ${buildEscapedContainsPattern(value)} escape '\\'`;
	}

	if (expressionType.propertyType === "array") {
		const expression = input.compiler.compile(
			input.predicate.expression,
			"array",
		);
		const valueType = input.compiler.getTypeInfo(input.predicate.value);
		const value = input.compiler.compile(input.predicate.value);
		return sql`${expression} @> jsonb_build_array(${valueType.kind === "property" && ["array", "object"].includes(valueType.propertyType) ? value : toJsonbExpression(value)})`;
	}

	if (expressionType.propertyType === "object") {
		const expression = input.compiler.compile(
			input.predicate.expression,
			"object",
		);
		const value = toJsonbExpression(
			input.compiler.compile(input.predicate.value),
		);
		return sql`${expression} @> ${value}`;
	}

	throw new ViewRuntimeValidationError(
		`Filter operator 'contains' is not supported for expression type '${expressionType.propertyType}'`,
	);
};

export const buildFilterWhereClause = <
	TSchema extends ViewRuntimeSchemaLike,
	TJoin extends ViewRuntimeEventJoinLike,
>(input: {
	alias: string;
	predicate: ViewPredicate | null;
	computedFields?: ViewComputedField[];
	context: ViewRuntimeReferenceContext<TSchema, TJoin>;
}) => {
	if (!input.predicate) {
		return undefined;
	}

	const compiler = createScalarExpressionCompiler({
		alias: input.alias,
		context: input.context,
		computedFields: input.computedFields,
	});

	return buildPredicateClause({ predicate: input.predicate, compiler });
};
