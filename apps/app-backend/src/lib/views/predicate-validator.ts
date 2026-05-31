import { match } from "ts-pattern";

import type { QueryComputedField, QueryExpression, QueryFilter } from "~/lib/query-language";

import { buildComputedFieldMap } from "./computed-fields";
import { QueryEngineValidationError } from "./errors";
import {
	assertComparableExpression,
	assertCompatibleComparisonTypes,
	assertContainsCompatibleExpression,
	assertFilterCompatibleExpression,
	inferViewExpressionType,
} from "./expression-analysis";
import type {
	QueryEngineEventJoinLike,
	QueryEngineReferenceContext,
	QueryEngineSchemaLike,
} from "./reference";

export const validateViewPredicateAgainstSchemas = <
	TSchema extends QueryEngineSchemaLike,
	TJoin extends QueryEngineEventJoinLike,
>(input: {
	predicate: QueryFilter;
	validBuiltins: ReadonlySet<string>;
	computedFields?: ReadonlyArray<QueryComputedField>;
	context: QueryEngineReferenceContext<TSchema, TJoin>;
	validateExpression?: (expression: QueryExpression) => void;
}) => {
	const computedFieldMap = buildComputedFieldMap(input.computedFields);
	const typeCache = new Map();

	const getType = (expression: QueryExpression) => {
		return inferViewExpressionType({
			typeCache,
			expression,
			computedFieldMap,
			context: input.context,
		});
	};

	const validateFilterExpression = (expression: QueryExpression) => {
		input.validateExpression?.(expression);

		const result = getType(expression);
		if (expression.type === "reference" && expression.reference.type === "entity-schema") {
			const [column] = expression.reference.path;
			if (column && !input.validBuiltins.has(column)) {
				throw new QueryEngineValidationError(
					`Entity schema column 'entity-schema.${column}' is not valid in this context`,
				);
			}
		}
		return result;
	};

	const validatePredicate = (predicate: QueryFilter): void => {
		match(predicate)
			.with({ type: "and" }, { type: "or" }, (pred) => {
				for (const child of pred.predicates) {
					validatePredicate(child);
				}
			})
			.with({ type: "not" }, (pred) => validatePredicate(pred.predicate))
			.with({ type: "isNull" }, { type: "isNotNull" }, (pred) => {
				assertFilterCompatibleExpression(validateFilterExpression(pred.expression), "filtering");
			})
			.with({ type: "contains" }, (pred) => {
				const expressionType = validateFilterExpression(pred.expression);
				const valueType = validateFilterExpression(pred.value);
				assertContainsCompatibleExpression(expressionType);
				assertFilterCompatibleExpression(valueType, "filtering");

				if (expressionType.kind === "property" && expressionType.propertyType === "string") {
					if (valueType.kind !== "property" || valueType.propertyType !== "string") {
						throw new QueryEngineValidationError(
							"Filter operator 'contains' requires a string expression value for string expressions",
						);
					}
				}

				if (valueType.kind === "null") {
					throw new QueryEngineValidationError(
						"Filter operator 'contains' does not support null expression values",
					);
				}

				if (expressionType.kind === "property" && expressionType.propertyType === "array") {
					if (
						valueType.kind !== "property" ||
						["array", "object"].includes(valueType.propertyType)
					) {
						throw new QueryEngineValidationError(
							"Filter operator 'contains' for array expressions requires a scalar or object item expression",
						);
					}
				}

				if (
					expressionType.kind === "property" &&
					expressionType.propertyType === "object" &&
					(valueType.kind !== "property" || valueType.propertyType !== "object")
				) {
					throw new QueryEngineValidationError(
						"Filter operator 'contains' for object expressions requires an object expression value",
					);
				}
			})
			.with({ type: "in" }, (pred) => {
				const expressionType = validateFilterExpression(pred.expression);
				assertComparableExpression(expressionType, "in");

				for (const value of pred.values) {
					assertCompatibleComparisonTypes({
						operator: "in",
						left: expressionType,
						right: validateFilterExpression(value),
					});
				}
			})
			.with({ type: "comparison" }, (pred) => {
				assertCompatibleComparisonTypes({
					operator: pred.operator,
					left: validateFilterExpression(pred.left),
					right: validateFilterExpression(pred.right),
				});
			})
			.exhaustive();
	};

	validatePredicate(input.predicate);
};
