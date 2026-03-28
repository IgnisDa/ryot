import type { ViewComputedField, ViewExpression } from "~/lib/views/expression";
import {
	assertSortableExpression,
	normalizeExpressionPropertyType,
} from "~/lib/views/expression-analysis";
import type {
	ViewRuntimeEventJoinLike,
	ViewRuntimeReferenceContext,
	ViewRuntimeSchemaLike,
} from "~/lib/views/reference";
import { createScalarExpressionCompiler } from "./expression-compiler";

export const buildSortExpression = <
	TSchema extends ViewRuntimeSchemaLike,
	TJoin extends ViewRuntimeEventJoinLike,
>(input: {
	alias: string;
	expression: ViewExpression;
	computedFields?: ViewComputedField[];
	context: ViewRuntimeReferenceContext<TSchema, TJoin>;
}) => {
	const compiler = createScalarExpressionCompiler({
		alias: input.alias,
		context: input.context,
		computedFields: input.computedFields,
	});
	const typeInfo = compiler.getTypeInfo(input.expression);
	assertSortableExpression(typeInfo);

	return compiler.compile(
		input.expression,
		typeInfo.kind === "property"
			? normalizeExpressionPropertyType(typeInfo.propertyType)
			: undefined,
	);
};
