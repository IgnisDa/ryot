import { ViewRuntimeValidationError } from "./errors";
import type { ViewComputedField, ViewExpression } from "./expression";

export const buildComputedFieldMap = (
	computedFields: ViewComputedField[] = [],
) => {
	const computedFieldMap = new Map<string, ViewComputedField>();

	for (const computedField of computedFields) {
		if (computedFieldMap.has(computedField.key)) {
			throw new ViewRuntimeValidationError(
				`Computed field '${computedField.key}' is defined more than once`,
			);
		}

		computedFieldMap.set(computedField.key, computedField);
	}

	return computedFieldMap;
};

const collectExpressionDependencies = (
	expression: ViewExpression,
	dependencies: string[],
) => {
	if (expression.type === "literal") {
		return dependencies;
	}

	if (expression.type === "reference") {
		if (expression.reference.type === "computed-field") {
			dependencies.push(expression.reference.key);
		}

		return dependencies;
	}

	for (const value of expression.values) {
		collectExpressionDependencies(value, dependencies);
	}

	return dependencies;
};

export const getComputedFieldDependencies = (expression: ViewExpression) => {
	return collectExpressionDependencies(expression, []);
};

export const orderComputedFields = (
	computedFields: ViewComputedField[] = [],
): ViewComputedField[] => {
	const visiting: string[] = [];
	const visited = new Set<string>();
	const orderedFields: ViewComputedField[] = [];
	const computedFieldMap = buildComputedFieldMap(computedFields);

	const visit = (key: string) => {
		if (visited.has(key)) {
			return;
		}

		const cycleIndex = visiting.indexOf(key);
		if (cycleIndex !== -1) {
			const cyclePath = [...visiting.slice(cycleIndex), key].join(" -> ");
			throw new ViewRuntimeValidationError(
				`Computed field dependency cycle detected: ${cyclePath}`,
			);
		}

		const computedField = computedFieldMap.get(key);
		if (!computedField) {
			throw new ViewRuntimeValidationError(
				`Computed field '${key}' is not part of this runtime request`,
			);
		}

		visiting.push(key);
		for (const dependencyKey of getComputedFieldDependencies(
			computedField.expression,
		)) {
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
