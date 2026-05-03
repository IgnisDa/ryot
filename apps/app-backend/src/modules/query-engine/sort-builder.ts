import type { ViewComputedField, ViewExpression } from "~/lib/views/expression";
import {
	assertSortableExpression,
	normalizeExpressionPropertyType,
} from "~/lib/views/expression-analysis";
import type { QueryEngineContext } from "./context";
import { createScalarExpressionCompiler } from "./expression-compiler";
import { createExpressionTypeResolver } from "./expression-type-resolver";

export const buildSortExpression = (input: {
	alias: string;
	expression: ViewExpression;
	context: QueryEngineContext;
	computedFields?: ViewComputedField[];
}) => {
	const getTypeInfo = createExpressionTypeResolver({
		context: input.context,
		computedFields: input.computedFields,
	});
	const compiler = createScalarExpressionCompiler({
		getTypeInfo,
		alias: input.alias,
		context: input.context,
		computedFields: input.computedFields,
	});
	const typeInfo = getTypeInfo(input.expression);
	assertSortableExpression(typeInfo);

	return compiler.compile(
		input.expression,
		typeInfo.kind === "property"
			? normalizeExpressionPropertyType(typeInfo.propertyType)
			: undefined,
	);
};
