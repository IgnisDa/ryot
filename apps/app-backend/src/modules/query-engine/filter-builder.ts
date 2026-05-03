import type { ViewComputedField } from "~/lib/views/expression";
import type { ViewPredicate } from "~/lib/views/filtering";
import type { QueryEngineContext } from "./context";
import { createScalarExpressionCompiler } from "./expression-compiler";
import { createExpressionTypeResolver } from "./expression-type-resolver";
import { buildPredicateClause } from "./predicate-clause-builder";

export const buildFilterWhereClause = (input: {
	alias: string;
	context: QueryEngineContext;
	predicate: ViewPredicate | null;
	computedFields?: ViewComputedField[];
}) => {
	if (!input.predicate) {
		return undefined;
	}

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

	return buildPredicateClause({
		predicate: input.predicate,
		compiler: { compile: compiler.compile, getTypeInfo },
	});
};
