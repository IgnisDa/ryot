import type { ViewComputedField } from "~/lib/views/expression";
import type { ViewPredicate } from "~/lib/views/filtering";
import type {
	ViewRuntimeEventJoinLike,
	ViewRuntimeReferenceContext,
	ViewRuntimeSchemaLike,
} from "~/lib/views/reference";
import { createScalarExpressionCompiler } from "./expression-compiler";
import { buildPredicateClause } from "./predicate-clause-builder";

export const buildFilterWhereClause = <
	TSchema extends ViewRuntimeSchemaLike,
	TJoin extends ViewRuntimeEventJoinLike,
>(input: {
	alias: string;
	predicate: ViewPredicate | null;
	computedFields?: ViewComputedField[];
	context: ViewRuntimeReferenceContext<TSchema, TJoin>;
}) => {
	if (!input.predicate) {
		return undefined;
	}

	const compiler = createScalarExpressionCompiler({
		alias: input.alias,
		context: input.context,
		computedFields: input.computedFields,
	});

	return buildPredicateClause({ predicate: input.predicate, compiler });
};
