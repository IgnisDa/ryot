import { Either, Match, Schema } from "effect";

import type { QueryComputedField, QueryExpression, QueryFilter } from "#lib/query-language";
import type { AppObjectProperty, AppPropertyDefinition } from "#lib/schema/property-schema";
import {
	createPropertyValueSchema,
	type PropertyValueField,
} from "#lib/schema/property-schema-runtime";

import { buildComputedFieldMap } from "./computed-fields";
import { QueryEngineValidationError } from "./errors";
import {
	assertComparableExpression,
	assertCompatibleComparisonTypes,
	assertContainsCompatibleExpression,
	assertFilterCompatibleExpression,
	inferViewExpressionType,
} from "./expression-analysis";
import type { QueryEngineReferenceContext } from "./reference";

const validateLiteralAgainstSchema = (
	value: unknown,
	schema: Schema.Schema.AnyNoContext,
	message: string,
) => {
	if (Either.isRight(Schema.decodeUnknownEither(schema)(value))) {
		return;
	}

	throw new QueryEngineValidationError(message);
};

const createObjectContainsSchema = (property: AppObjectProperty) => {
	const shape: Record<string, PropertyValueField> = {};

	for (const [key, value] of Object.entries(property.properties)) {
		shape[key] = Schema.optional(createContainsValueSchema(value));
	}

	return Schema.Struct(shape).annotations({
		parseOptions: { onExcessProperty: "error" },
	});
};

const createContainsValueSchema = (property: AppPropertyDefinition): Schema.Schema.AnyNoContext => {
	if (property.type === "object") {
		return createObjectContainsSchema(property);
	}

	return createPropertyValueSchema(property);
};

export const validateViewPredicateAgainstSchemas = (input: {
	predicate: QueryFilter;
	validBuiltins: ReadonlySet<string>;
	context: QueryEngineReferenceContext;
	computedFields?: ReadonlyArray<QueryComputedField>;
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
		Match.value(predicate).pipe(
			Match.whenOr({ type: "and" }, { type: "or" }, (pred) => {
				for (const child of pred.predicates) {
					validatePredicate(child);
				}
			}),
			Match.when({ type: "not" }, (pred) => validatePredicate(pred.predicate)),
			Match.whenOr({ type: "isNull" }, { type: "isNotNull" }, (pred) => {
				assertFilterCompatibleExpression(validateFilterExpression(pred.expression), "filtering");
			}),
			Match.when({ type: "contains" }, (pred) => {
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

				if (
					expressionType.kind === "property" &&
					expressionType.propertyDefinition &&
					pred.value.type === "literal"
				) {
					const literalValue = pred.value.value;
					const property = expressionType.propertyDefinition;

					if (property.type === "array") {
						validateLiteralAgainstSchema(
							literalValue,
							createContainsValueSchema(property.items),
							"Filter operator 'contains' received a literal value incompatible with the array item schema",
						);
					}

					if (property.type === "object") {
						validateLiteralAgainstSchema(
							literalValue,
							createObjectContainsSchema(property),
							"Filter operator 'contains' received a literal value incompatible with the object schema",
						);
					}
				}
			}),
			Match.when({ type: "in" }, (pred) => {
				const expressionType = validateFilterExpression(pred.expression);
				assertComparableExpression(expressionType, "in");

				for (const value of pred.values) {
					assertCompatibleComparisonTypes({
						operator: "in",
						left: expressionType,
						right: validateFilterExpression(value),
					});
				}
			}),
			Match.when({ type: "comparison" }, (pred) => {
				assertCompatibleComparisonTypes({
					operator: pred.operator,
					left: validateFilterExpression(pred.left),
					right: validateFilterExpression(pred.right),
				});
			}),
			Match.exhaustive,
		);
	};

	validatePredicate(input.predicate);
};
