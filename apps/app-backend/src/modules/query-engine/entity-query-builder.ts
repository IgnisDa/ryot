import { sql } from "drizzle-orm";

import { buildResolvedFieldsExpression } from "./display-builder";
import { createScalarExpressionCompiler } from "./expression-compiler";
import { createExpressionTypeResolver } from "./expression-type-resolver";
import { buildFilterWhereClause } from "./filter-builder";
import { executePaginatedQuery } from "./paginated-query-sql";
import { buildQueryContext, type PreparedQueryContext } from "./preparer";
import {
	buildBaseEntitiesCte,
	buildJoinedEntitiesCte,
	buildLatestEventJoinCte,
	ENTITY_CTE_ALIASES,
} from "./query-ctes";
import type { EntityQueryEngineRequest, QueryEngineEntityResponse } from "./schemas";
import { buildSortExpression } from "./sort-builder";

export const executePreparedQuery = async (input: {
	userId: string;
	context: PreparedQueryContext;
	request: EntityQueryEngineRequest;
}): Promise<QueryEngineEntityResponse> => {
	const queryContext = buildQueryContext(input.userId, input.context);
	const getTypeInfo = createExpressionTypeResolver({
		context: queryContext,
		computedFields: input.request.computedFields,
	});
	const createCompiler = (alias: string) => {
		const { compile } = createScalarExpressionCompiler({
			alias,
			getTypeInfo,
			context: queryContext,
			computedFields: input.request.computedFields,
		});
		return { compile, getTypeInfo };
	};
	const filterCompiler = createCompiler(ENTITY_CTE_ALIASES.joined);
	const filterWhereClause = buildFilterWhereClause({
		context: queryContext,
		compiler: filterCompiler,
		predicate: input.request.filter,
		computedFields: input.request.computedFields,
	});
	const sortCompiler = createCompiler(ENTITY_CTE_ALIASES.filtered);
	const sortExpression = buildSortExpression({
		context: queryContext,
		compiler: sortCompiler,
		expression: input.request.sort.expression,
		computedFields: input.request.computedFields,
	});
	const baseEntitiesCte = buildBaseEntitiesCte({
		userId: input.userId,
		relationshipSchemaIds: input.context.relationshipSchemaIds,
		entitySchemaIds: input.context.runtimeSchemas.map((schema) => schema.id),
	});
	const latestEventJoinCtes = input.context.eventJoins.map((join) => {
		return buildLatestEventJoinCte({ join, userId: input.userId });
	});
	const joinedEntitiesCte = buildJoinedEntitiesCte(input.context.eventJoins);
	const resolvedFields = buildResolvedFieldsExpression({
		getTypeInfo,
		context: queryContext,
		fields: input.request.fields,
		alias: ENTITY_CTE_ALIASES.paginated,
		computedFields: input.request.computedFields,
	});
	const direction = sql.raw(input.request.sort.direction.toUpperCase());
	const filterClause = filterWhereClause ?? sql`true`;

	const { pagination, items } = await executePaginatedQuery({
		direction,
		filterClause,
		sortExpression,
		resolvedFields,
		pagination: input.request.pagination,
		withCtes: [baseEntitiesCte, ...latestEventJoinCtes, joinedEntitiesCte],
		paginationConfig: {
			rowIdColumn: "id",
			countAlias: ENTITY_CTE_ALIASES.count,
			sortedAlias: ENTITY_CTE_ALIASES.sorted,
			filteredAlias: ENTITY_CTE_ALIASES.filtered,
			joinedTableName: ENTITY_CTE_ALIASES.joined,
			paginatedAlias: ENTITY_CTE_ALIASES.paginated,
		},
	});

	return {
		mode: "entities",
		data: { meta: { pagination }, items },
	} satisfies QueryEngineEntityResponse;
};
