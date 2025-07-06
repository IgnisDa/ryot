import type { ViewComputedField, ViewExpression } from "~/lib/views/expression";
import {
	assertSortableExpression,
	normalizeExpressionPropertyType,
} from "~/lib/views/expression-analysis";

import { createScalarExpressionCompiler, type ExpressionCompiler } from "./expression-compiler";
import { createExpressionTypeResolver } from "./expression-type-resolver";
import type { QueryEngineContext } from "./schemas";

export const buildSortExpression = (input: {
	alias?: string;
	expression: ViewExpression;
	context: QueryEngineContext;
	compiler?: ExpressionCompiler;
	computedFields?: ViewComputedField[];
}) => {
	const compiler = input.compiler ?? createDefaultCompiler(input);
	const typeInfo = compiler.getTypeInfo(input.expression);
	assertSortableExpression(typeInfo);

	return compiler.compile(
		input.expression,
		typeInfo.kind === "property"
			? normalizeExpressionPropertyType(typeInfo.propertyType)
			: undefined,
	);
};

const createDefaultCompiler = (input: {
	alias?: string;
	context: QueryEngineContext;
	computedFields?: ViewComputedField[];
}): ExpressionCompiler => {
	if (!input.alias) {
		throw new Error("alias is required when no compiler is provided");
	}
	const getTypeInfo = createExpressionTypeResolver({
		context: input.context,
		computedFields: input.computedFields,
	});
	const { compile } = createScalarExpressionCompiler({
		getTypeInfo,
		alias: input.alias,
		context: input.context,
		computedFields: input.computedFields,
	});
	return { compile, getTypeInfo };
};
