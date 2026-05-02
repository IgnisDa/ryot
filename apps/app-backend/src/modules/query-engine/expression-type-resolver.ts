import { buildComputedFieldMap } from "~/lib/views/computed-fields";
import type { ViewComputedField, ViewExpression } from "~/lib/views/expression";
import {
	inferViewExpressionType,
	type ViewExpressionTypeInfo,
} from "~/lib/views/expression-analysis";
import type {
	QueryEngineEventJoinLike,
	QueryEngineReferenceContext,
	QueryEngineSchemaLike,
} from "~/lib/views/reference";

export const createExpressionTypeResolver = <
	TSchema extends QueryEngineSchemaLike,
	TJoin extends QueryEngineEventJoinLike,
>(input: {
	context: QueryEngineReferenceContext<TSchema, TJoin>;
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
