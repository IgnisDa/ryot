import { z } from "@hono/zod-openapi";
import { type AppObjectProperty, type AppPropertyDefinition, fromAppSchema } from "@ryot/ts-utils";
import { match } from "ts-pattern";

import { buildComputedFieldMap } from "./computed-fields";
import { QueryEngineValidationError } from "./errors";
import type { ViewComputedField, ViewExpression, ViewPredicate } from "./expression";
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
	predicate: ViewPredicate;
	validBuiltins: ReadonlySet<string>;
	computedFields?: ViewComputedField[];
	context: QueryEngineReferenceContext<TSchema, TJoin>;
	validateExpression?: (expression: ViewExpression) => void;
}) => {
	const computedFieldMap = buildComputedFieldMap(input.computedFields);
	const typeCache = new Map();

	const createObjectContainsSchema = (property: AppObjectProperty): z.ZodType => {
		const shape: Record<string, z.ZodType> = {};

		for (const [key, value] of Object.entries(property.properties)) {
			shape[key] = createContainsValueSchema(value).optional();
		}

		return z.object(shape).strict();
	};

	const createContainsValueSchema = (property: AppPropertyDefinition): z.ZodType => {
		return match(property)
			.with({ type: "object" }, (prop) => createObjectContainsSchema(prop))
			.otherwise((prop) => fromAppSchema(prop));
	};

	const validateLiteralAgainstSchema = (value: unknown, schema: z.ZodType, message: string) => {
		const result = schema.safeParse(value);
		if (!result.success) {
			throw new QueryEngineValidationError(message);
		}
	};

	const getType = (expression: Parameters<typeof inferViewExpressionType>[0]["expression"]) => {
		return inferViewExpressionType({
			typeCache,
			expression,
			computedFieldMap,
			context: input.context,
		});
	};

	const validateFilterExpression = (
		expression: Parameters<typeof inferViewExpressionType>[0]["expression"],
	) => {
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

	const validatePredicate = (predicate: ViewPredicate): void => {
		if (predicate.type === "and" || predicate.type === "or") {
			for (const child of predicate.predicates) {
				validatePredicate(child);
			}

			return;
		}

		if (predicate.type === "not") {
			validatePredicate(predicate.predicate);
			return;
		}

		if (predicate.type === "isNull" || predicate.type === "isNotNull") {
			assertFilterCompatibleExpression(validateFilterExpression(predicate.expression), "filtering");
			return;
		}

		if (predicate.type === "contains") {
			const expressionType = validateFilterExpression(predicate.expression);
			const valueType = validateFilterExpression(predicate.value);
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
				if (valueType.kind !== "property" || ["array", "object"].includes(valueType.propertyType)) {
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
				predicate.value.type === "literal"
			) {
				const literalValue = predicate.value.value;
				match(expressionType.propertyDefinition)
					.with({ type: "array" }, (property) =>
						validateLiteralAgainstSchema(
							literalValue,
							createContainsValueSchema(property.items),
							"Filter operator 'contains' received a literal value incompatible with the array item schema",
						),
					)
					.with({ type: "object" }, (property) =>
						validateLiteralAgainstSchema(
							literalValue,
							createObjectContainsSchema(property),
							"Filter operator 'contains' received a literal value incompatible with the object schema",
						),
					)
					.otherwise(() => undefined);
			}

			return;
		}

		if (predicate.type === "in") {
			const expressionType = validateFilterExpression(predicate.expression);
			assertComparableExpression(expressionType, "in");

			for (const value of predicate.values) {
				assertCompatibleComparisonTypes({
					operator: "in",
					left: expressionType,
					right: validateFilterExpression(value),
				});
			}

			return;
		}

		assertCompatibleComparisonTypes({
			operator: predicate.operator,
			left: validateFilterExpression(predicate.left),
			right: validateFilterExpression(predicate.right),
		});
	};

	validatePredicate(input.predicate);
};
