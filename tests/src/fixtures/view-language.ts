import {
	entityBuiltinColumns,
	entitySchemaBuiltinColumns,
	eventJoinBuiltinColumns,
	relationshipJoinBuiltinColumns,
	type RuntimeRef,
	type RuntimeReferenceExpression,
	type TransformExpression,
} from "@ryot/ts-utils/view-language";

// TODO(Task 22): Replace these tests-only DSL types with the public AppContract types
// once queryDefinition and displayConfiguration stop being `unknown` in the contract.
type ArithmeticOperator = "add" | "subtract" | "multiply" | "divide";
type ComparisonOperator = "eq" | "neq" | "gt" | "gte" | "lt" | "lte";

type LiteralExpression = {
	type: "literal";
	value: unknown;
};

type ArithmeticExpression = {
	type: "arithmetic";
	operator: ArithmeticOperator;
	left: ViewExpression;
	right: ViewExpression;
};

type ConcatExpression = {
	type: "concat";
	values: ViewExpression[];
};

type CoalesceExpression = {
	type: "coalesce";
	values: ViewExpression[];
};

type RoundExpression = {
	type: "round";
	expression: ViewExpression;
};

type FloorExpression = {
	type: "floor";
	expression: ViewExpression;
};

type IntegerExpression = {
	type: "integer";
	expression: ViewExpression;
};

type ConditionalExpression = {
	type: "conditional";
	condition: ViewPredicate;
	whenTrue: ViewExpression;
	whenFalse: ViewExpression;
};

export type ViewExpression =
	| ArithmeticExpression
	| CoalesceExpression
	| ConcatExpression
	| ConditionalExpression
	| FloorExpression
	| IntegerExpression
	| LiteralExpression
	| RoundExpression
	| RuntimeReferenceExpression
	| TransformExpression;

type ComparisonPredicate = {
	type: "comparison";
	operator: ComparisonOperator;
	left: ViewExpression;
	right: ViewExpression;
};

type ContainsPredicate = {
	type: "contains";
	expression: ViewExpression;
	value: ViewExpression;
};

type InPredicate = {
	type: "in";
	expression: ViewExpression;
	values: ViewExpression[];
};

type UnaryPredicate = {
	type: "isNull" | "isNotNull";
	expression: ViewExpression;
};

type LogicalPredicate = {
	type: "and" | "or";
	predicates: ViewPredicate[];
};

type NotPredicate = {
	type: "not";
	predicate: ViewPredicate;
};

export type ViewPredicate =
	| ComparisonPredicate
	| ContainsPredicate
	| InPredicate
	| LogicalPredicate
	| NotPredicate
	| UnaryPredicate;
export type ExpressionInput = ViewExpression | string[];

export const literalExpression = (value: unknown): ViewExpression => ({
	value,
	type: "literal",
});

export const parseFieldPath = (field: string): RuntimeRef => {
	const [namespace, segment, tail, ...rest] = field.split(".");

	if (namespace === "computed") {
		if (!segment || tail !== undefined || rest.length > 0) {
			throw new Error(`Invalid field path: ${field}`);
		}

		return { key: segment, type: "computed-field" };
	}

	if (namespace === "event") {
		if (!segment || !tail) {
			throw new Error(`Invalid field path: ${field}`);
		}

		if (tail === "properties") {
			if (rest.length === 0) {
				throw new Error(`Invalid field path: ${field}`);
			}

			return { joinKey: segment, path: [tail, ...rest], type: "event-join" };
		}

		if (rest.length > 0 || !eventJoinBuiltinColumns.has(tail)) {
			throw new Error(`Invalid field path: ${field}`);
		}

		return { joinKey: segment, path: [tail], type: "event-join" };
	}

	if (namespace === "relationship") {
		if (!segment || !tail) {
			throw new Error(`Invalid field path: ${field}`);
		}

		if (tail === "properties") {
			if (rest.length === 0) {
				throw new Error(`Invalid field path: ${field}`);
			}

			return { joinKey: segment, path: [tail, ...rest], type: "relationship-join" };
		}

		if (tail === "sourceEntity" || tail === "targetEntity") {
			const [entityColumn, ...entityRest] = rest;
			if (!entityColumn) {
				throw new Error(`Invalid field path: ${field}`);
			}
			if (entityColumn === "properties") {
				if (entityRest.length === 0) {
					throw new Error(`Invalid field path: ${field}`);
				}
				return {
					joinKey: segment,
					type: "relationship-join",
					path: [tail, "properties", ...entityRest],
				};
			}
			if (entityRest.length > 0 || !entityBuiltinColumns.has(entityColumn)) {
				throw new Error(`Invalid field path: ${field}`);
			}
			return { joinKey: segment, path: [tail, entityColumn], type: "relationship-join" };
		}

		if (rest.length > 0 || !relationshipJoinBuiltinColumns.has(tail)) {
			throw new Error(`Invalid field path: ${field}`);
		}

		return { joinKey: segment, path: [tail], type: "relationship-join" };
	}

	if (namespace === "entity-schema") {
		if (!segment || tail !== undefined || rest.length > 0) {
			throw new Error(`Invalid field path: ${field}`);
		}
		if (!entitySchemaBuiltinColumns.has(segment)) {
			throw new Error(`Invalid field path: ${field}`);
		}

		return { path: [segment], type: "entity-schema" };
	}

	if (namespace !== "entity" || !segment || !tail) {
		throw new Error(`Invalid field path: ${field}`);
	}

	if (tail === "properties") {
		if (rest.length === 0) {
			throw new Error(`Invalid field path: ${field}`);
		}

		return { slug: segment, path: [tail, ...rest], type: "entity" };
	}

	if (rest.length > 0 || !entityBuiltinColumns.has(tail)) {
		throw new Error(`Invalid field path: ${field}`);
	}

	return { slug: segment, path: [tail], type: "entity" };
};

export const entityField = (schemaSlug: string, property: string) => {
	if (entityBuiltinColumns.has(property)) {
		return `entity.${schemaSlug}.${property}`;
	}

	return `entity.${schemaSlug}.properties.${property}`;
};

export const relationshipJoinField = (joinKey: string, ...path: string[]) => {
	return `relationship.${joinKey}.${path.join(".")}`;
};

export const qualifyBuiltinFields = (schemaSlugs: string[], property: string) => {
	return schemaSlugs.map((schemaSlug) => entityField(schemaSlug, property));
};

export const toExpression = (input: ExpressionInput | null): ViewExpression | null => {
	if (input === null) {
		return null;
	}

	if (!Array.isArray(input)) {
		return input;
	}

	if (!input.length) {
		return literalExpression(null);
	}

	const values = input.map((reference) => ({
		type: "reference" as const,
		reference: parseFieldPath(reference),
	}));

	return values.length === 1
		? (values[0] ?? literalExpression(null))
		: { values, type: "coalesce" };
};

export const toRequiredExpression = (input: ExpressionInput | null) => {
	return toExpression(input) ?? literalExpression(null);
};
