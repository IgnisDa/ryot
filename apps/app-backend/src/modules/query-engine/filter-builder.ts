import type { ViewComputedField } from "~/lib/views/expression";
import type { ViewPredicate } from "~/lib/views/filtering";

import { createScalarExpressionCompiler, type ExpressionCompiler } from "./expression-compiler";
import { createExpressionTypeResolver } from "./expression-type-resolver";
import { buildPredicateClause } from "./predicate-clause-builder";
import type { QueryEngineContext } from "./schemas";

export const buildFilterWhereClause = (input: {
	context: QueryEngineContext;
	compiler?: ExpressionCompiler;
	predicate: ViewPredicate | null;
	computedFields?: ViewComputedField[];
	alias?: string;
}) => {
	if (!input.predicate) {
		return undefined;
	}

	const compiler = input.compiler ?? createDefaultCompiler(input);

	return buildPredicateClause({ compiler, predicate: input.predicate });
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
