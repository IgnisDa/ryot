import { sql } from "drizzle-orm";

import type { ViewComputedField, ViewPredicate } from "~/lib/views/expression";

import type { ExpressionCompiler } from "./expression-compiler";
import { buildPredicateClause } from "./predicate-clause-builder";
import type { QueryEngineContext } from "./schemas";

type FilterBuilderInput = {
	context: QueryEngineContext;
	compiler: ExpressionCompiler;
	predicate: ViewPredicate | null;
	computedFields?: ViewComputedField[];
};

export const buildFilterWhereClause = (input: FilterBuilderInput) => {
	if (!input.predicate) {
		return sql`true`;
	}

	return buildPredicateClause({ compiler: input.compiler, predicate: input.predicate });
};
