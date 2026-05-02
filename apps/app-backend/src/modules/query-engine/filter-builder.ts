import { sql } from "drizzle-orm";

import type { QueryComputedField, QueryFilter } from "#lib/query-language";

import type { QueryEngineContext } from "./context";
import type { ExpressionCompiler } from "./expression-compiler";
import { buildPredicateClause } from "./predicate-clause-builder";

type FilterBuilderInput = {
	context: QueryEngineContext;
	compiler: ExpressionCompiler;
	predicate: QueryFilter | null | undefined;
	computedFields?: ReadonlyArray<QueryComputedField>;
};

export const buildFilterWhereClause = (input: FilterBuilderInput) => {
	if (!input.predicate) {
		return sql`true`;
	}

	return buildPredicateClause({ compiler: input.compiler, predicate: input.predicate });
};
