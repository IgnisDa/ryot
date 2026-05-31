import { match } from "ts-pattern";

import { QueryEngineValidationError } from "./errors";
import type { ViewComputedField, ViewExpression, ViewPredicate } from "./expression";

export const buildComputedFieldMap = (computedFields: ViewComputedField[] = []) => {
	const computedFieldMap = new Map<string, ViewComputedField>();

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
	computedFieldMap: Map<string, ViewComputedField>,
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

const collectExpressionDependencies = (expression: ViewExpression, dependencies: string[]) => {
	return match(expression)
		.with({ type: "literal" }, () => dependencies)
		.with({ type: "reference" }, (expr) => {
			if (expr.reference.type === "computed-field") {
				dependencies.push(expr.reference.key);
			}
			return dependencies;
		})
		.with({ type: "arithmetic" }, (expr) => {
			collectExpressionDependencies(expr.left, dependencies);
			collectExpressionDependencies(expr.right, dependencies);
			return dependencies;
		})
		.with(
			{ type: "round" },
			{ type: "floor" },
			{ type: "integer" },
			{ type: "transform" },
			(expr) => {
				collectExpressionDependencies(expr.expression, dependencies);
				return dependencies;
			},
		)
		.with({ type: "conditional" }, (expr) => {
			collectPredicateDependencies(expr.condition, dependencies);
			collectExpressionDependencies(expr.whenTrue, dependencies);
			collectExpressionDependencies(expr.whenFalse, dependencies);
			return dependencies;
		})
		.with({ type: "coalesce" }, { type: "concat" }, (expr) => {
			for (const value of expr.values) {
				collectExpressionDependencies(value, dependencies);
			}
			return dependencies;
		})
		.exhaustive();
};

const collectPredicateDependencies = (predicate: ViewPredicate, dependencies: string[]) => {
	return match(predicate)
		.with({ type: "and" }, { type: "or" }, (pred) => {
			for (const child of pred.predicates) {
				collectPredicateDependencies(child, dependencies);
			}
			return dependencies;
		})
		.with({ type: "not" }, (pred) => {
			collectPredicateDependencies(pred.predicate, dependencies);
			return dependencies;
		})
		.with({ type: "comparison" }, (pred) => {
			collectExpressionDependencies(pred.left, dependencies);
			collectExpressionDependencies(pred.right, dependencies);
			return dependencies;
		})
		.with({ type: "contains" }, (pred) => {
			collectExpressionDependencies(pred.expression, dependencies);
			collectExpressionDependencies(pred.value, dependencies);
			return dependencies;
		})
		.with({ type: "isNull" }, { type: "isNotNull" }, (pred) => {
			collectExpressionDependencies(pred.expression, dependencies);
			return dependencies;
		})
		.with({ type: "in" }, (pred) => {
			collectExpressionDependencies(pred.expression, dependencies);
			for (const value of pred.values) {
				collectExpressionDependencies(value, dependencies);
			}
			return dependencies;
		})
		.exhaustive();
};

export const getComputedFieldDependencies = (expression: ViewExpression) => {
	return collectExpressionDependencies(expression, []);
};

const orderComputedFieldsFromMap = (
	computedFields: ViewComputedField[],
	computedFieldMap: Map<string, ViewComputedField>,
) => {
	const visiting: string[] = [];
	const visited = new Set<string>();
	const orderedFields: ViewComputedField[] = [];

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

export const prepareComputedFields = (computedFields: ViewComputedField[] = []) => {
	const computedFieldMap = buildComputedFieldMap(computedFields);

	return {
		computedFieldMap,
		orderedComputedFields: orderComputedFieldsFromMap(computedFields, computedFieldMap),
	};
};

export const orderComputedFields = (
	computedFields: ViewComputedField[] = [],
): ViewComputedField[] => {
	return prepareComputedFields(computedFields).orderedComputedFields;
};
