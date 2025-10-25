import type { ViewComputedField, ViewExpression } from "~/lib/views/expression";
import {
	assertSortableExpression,
	normalizeExpressionPropertyType,
} from "~/lib/views/expression-analysis";

import type { ExpressionCompiler } from "./expression-compiler";
import type { QueryEngineContext } from "./schemas";

type SortBuilderInput = {
	expression: ViewExpression;
	context: QueryEngineContext;
	compiler: ExpressionCompiler;
	computedFields?: ViewComputedField[];
};

export const buildSortExpression = (input: SortBuilderInput) => {
	const typeInfo = input.compiler.getTypeInfo(input.expression);
	assertSortableExpression(typeInfo);

	return input.compiler.compile(
		input.expression,
		typeInfo.kind === "property"
			? normalizeExpressionPropertyType(typeInfo.propertyType)
			: undefined,
	);
};
