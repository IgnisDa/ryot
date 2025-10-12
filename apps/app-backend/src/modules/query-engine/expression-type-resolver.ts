import type { QueryComputedField, QueryExpression } from "#lib/query-language";
import { buildComputedFieldMap } from "#lib/views/computed-fields";
import {
	inferViewExpressionType,
	type ViewExpressionTypeInfo,
} from "#lib/views/expression-analysis";

import type { QueryEngineContext } from "./context";

export const createExpressionTypeResolver = (input: {
	context: QueryEngineContext;
	computedFields?: ReadonlyArray<QueryComputedField>;
}) => {
	const computedFieldMap = buildComputedFieldMap(input.computedFields);
	const typeCache = new Map<string, ViewExpressionTypeInfo>();

	return (expression: QueryExpression) =>
		inferViewExpressionType({
			typeCache,
			expression,
			computedFieldMap,
			context: input.context,
		});
};
