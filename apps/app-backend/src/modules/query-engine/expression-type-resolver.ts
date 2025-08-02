import { buildComputedFieldMap } from "~/lib/views/computed-fields";
import type { ViewComputedField, ViewExpression } from "~/lib/views/expression";
import {
	inferViewExpressionType,
	type ViewExpressionTypeInfo,
} from "~/lib/views/expression-analysis";
import type { QueryEngineContext } from "./context";

export const createExpressionTypeResolver = (input: {
	context: QueryEngineContext;
	computedFields?: ViewComputedField[];
}) => {
	const computedFieldMap = buildComputedFieldMap(input.computedFields);
	const typeCache = new Map<string, ViewExpressionTypeInfo>();

	return (expression: ViewExpression) =>
		inferViewExpressionType({
			typeCache,
			expression,
			computedFieldMap,
			context: input.context,
		});
};
