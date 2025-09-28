import type { QueryComputedField, QueryExpression } from "~/lib/query-language";
import {
	assertSortableExpression,
	normalizeExpressionPropertyType,
} from "~/lib/views/expression-analysis";

import type { QueryEngineContext } from "./context";
import type { ExpressionCompiler } from "./expression-compiler";

type SortBuilderInput = {
	expression: QueryExpression;
	context: QueryEngineContext;
	compiler: ExpressionCompiler;
	computedFields?: ReadonlyArray<QueryComputedField>;
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
