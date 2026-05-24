import { Match } from "effect";

import type { QueryComputedField, QueryExpression, QueryFilter } from "#lib/query-language";

import { QueryEngineValidationError } from "./errors";

export { QueryComputedField as ViewComputedField };

export const buildComputedFieldMap = (computedFields: ReadonlyArray<QueryComputedField> = []) => {
	const computedFieldMap = new Map<string, QueryComputedField>();

	for (const computedField of computedFields) {
		if (computedFieldMap.has(computedField.key)) {
			throw new QueryEngineValidationError(
				`Computed field '${computedField.key}' is defined more than once`,
			);
		}

		computedFieldMap.set(computedField.key, computedField);
	}

	return computedFieldMap;
};

export const getComputedFieldOrThrow = (
	computedFieldMap: Map<string, QueryComputedField>,
	key: string,
) => {
	const computedField = computedFieldMap.get(key);
	if (!computedField) {
		throw new QueryEngineValidationError(
			`Computed field '${key}' is not part of this runtime request`,
		);
	}

	return computedField;
};

const collectExpressionDependencies = (
	expression: QueryExpression,
	dependencies: string[],
): string[] => {
	return Match.value(expression).pipe(
		Match.when({ type: "literal" }, () => dependencies),
		Match.when({ type: "reference" }, (expr) => {
			if (expr.reference.type === "computed-field") {
				dependencies.push(expr.reference.key);
			}
			return dependencies;
		}),
		Match.when({ type: "isNotNull" }, (expr) => {
			collectExpressionDependencies(expr.expression, dependencies);
			return dependencies;
		}),
		Match.when({ type: "arithmetic" }, (expr) => {
			collectExpressionDependencies(expr.left, dependencies);
			collectExpressionDependencies(expr.right, dependencies);
			return dependencies;
		}),
		Match.whenOr(
			{ type: "round" },
			{ type: "floor" },
			{ type: "integer" },
			{ type: "transform" },
			(expr) => {
				collectExpressionDependencies(expr.expression, dependencies);
				return dependencies;
			},
		),
		Match.when({ type: "conditional" }, (expr) => {
			collectPredicateDependencies(expr.condition, dependencies);
			collectExpressionDependencies(expr.whenTrue, dependencies);
			collectExpressionDependencies(expr.whenFalse, dependencies);
			return dependencies;
		}),
		Match.whenOr({ type: "coalesce" }, { type: "concat" }, (expr) => {
			for (const value of expr.values) {
				collectExpressionDependencies(value, dependencies);
			}
			return dependencies;
		}),
		Match.exhaustive,
	);
};

const collectPredicateDependencies = (predicate: QueryFilter, dependencies: string[]): string[] => {
	return Match.value(predicate).pipe(
		Match.whenOr({ type: "and" }, { type: "or" }, (pred) => {
			for (const child of pred.predicates) {
				collectPredicateDependencies(child, dependencies);
			}
			return dependencies;
		}),
		Match.when({ type: "not" }, (pred) => {
			collectPredicateDependencies(pred.predicate, dependencies);
			return dependencies;
		}),
		Match.when({ type: "comparison" }, (pred) => {
			collectExpressionDependencies(pred.left, dependencies);
			collectExpressionDependencies(pred.right, dependencies);
			return dependencies;
		}),
		Match.when({ type: "contains" }, (pred) => {
			collectExpressionDependencies(pred.expression, dependencies);
			collectExpressionDependencies(pred.value, dependencies);
			return dependencies;
		}),
		Match.whenOr({ type: "isNull" }, { type: "isNotNull" }, (pred) => {
			collectExpressionDependencies(pred.expression, dependencies);
			return dependencies;
		}),
		Match.when({ type: "in" }, (pred) => {
			collectExpressionDependencies(pred.expression, dependencies);
			for (const value of pred.values) {
				collectExpressionDependencies(value, dependencies);
			}
			return dependencies;
		}),
		Match.exhaustive,
	);
};

export const getComputedFieldDependencies = (expression: QueryExpression): string[] => {
	return collectExpressionDependencies(expression, []);
};

const orderComputedFieldsFromMap = (
	computedFields: ReadonlyArray<QueryComputedField>,
	computedFieldMap: Map<string, QueryComputedField>,
): QueryComputedField[] => {
	const visiting: string[] = [];
	const visited = new Set<string>();
	const orderedFields: QueryComputedField[] = [];

	const visit = (key: string) => {
		if (visited.has(key)) {
			return;
		}

		const cycleIndex = visiting.indexOf(key);
		if (cycleIndex !== -1) {
			const cyclePath = [...visiting.slice(cycleIndex), key].join(" -> ");
			throw new QueryEngineValidationError(
				`Computed field dependency cycle detected: ${cyclePath}`,
			);
		}

		const computedField = getComputedFieldOrThrow(computedFieldMap, key);

		visiting.push(key);
		for (const dependencyKey of getComputedFieldDependencies(computedField.expression)) {
			visit(dependencyKey);
		}
		visiting.pop();
		visited.add(key);
		orderedFields.push(computedField);
	};

	for (const computedField of computedFields) {
		visit(computedField.key);
	}

	return orderedFields;
};

export const prepareComputedFields = (computedFields: ReadonlyArray<QueryComputedField> = []) => {
	const computedFieldMap = buildComputedFieldMap(computedFields);

	return {
		computedFieldMap,
		orderedComputedFields: orderComputedFieldsFromMap(computedFields, computedFieldMap),
	};
};

export const orderComputedFields = (
	computedFields: ReadonlyArray<QueryComputedField> = [],
): QueryComputedField[] => {
	return prepareComputedFields(computedFields).orderedComputedFields;
};
