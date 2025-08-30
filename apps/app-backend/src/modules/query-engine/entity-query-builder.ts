import { sql } from "drizzle-orm";

import { buildQueryContext, type PreparedQueryContext } from "./context";
import { buildResolvedFieldsExpression } from "./display-builder";
import { buildBaseEntitiesCte } from "./entity-query-ctes";
import { buildLatestEventJoinCte, buildJoinedEntitiesCte } from "./event-join-ctes";
import { createQueryCompiler } from "./expression-compiler";
import { createExpressionTypeResolver } from "./expression-type-resolver";
import { buildFilterWhereClause } from "./filter-builder";
import { executePaginatedQuery } from "./paginated-query-sql";
import { ENTITY_CTE_ALIASES } from "./query-cte-shared";
import {
	buildLatestRelationshipJoinCte,
	buildRequiredJoinWhereClause,
} from "./relationship-join-ctes";
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
	const filterCompiler = createQueryCompiler({
		getTypeInfo,
		context: queryContext,
		alias: ENTITY_CTE_ALIASES.joined,
		computedFields: input.request.computedFields,
	});
	const filterWhereClause = buildFilterWhereClause({
		context: queryContext,
		compiler: filterCompiler,
		predicate: input.request.filter,
		computedFields: input.request.computedFields,
	});
	const sortCompiler = createQueryCompiler({
		getTypeInfo,
		context: queryContext,
		alias: ENTITY_CTE_ALIASES.filtered,
		computedFields: input.request.computedFields,
	});
	const sortExpression = buildSortExpression({
		context: queryContext,
		compiler: sortCompiler,
		expression: input.request.sort.expression,
		computedFields: input.request.computedFields,
	});
	const baseEntitiesCte = buildBaseEntitiesCte({
		userId: input.userId,
		entitySchemaIds: input.context.runtimeSchemas.map((schema) => schema.id),
	});
	const latestEventJoinCtes = input.context.eventJoins.map((join) => {
		return buildLatestEventJoinCte({ join, userId: input.userId });
	});
	const latestRelationshipJoinCtes = input.context.relationshipJoins.map((join) => {
		return buildLatestRelationshipJoinCte({ join, userId: input.userId });
	});
	const joinedEntitiesCte = buildJoinedEntitiesCte({
		eventJoins: input.context.eventJoins,
		relationshipJoins: input.context.relationshipJoins,
	});
	const resolvedFields = buildResolvedFieldsExpression({
		getTypeInfo,
		context: queryContext,
		fields: input.request.fields,
		alias: ENTITY_CTE_ALIASES.paginated,
		computedFields: input.request.computedFields,
	});
	const direction = sql.raw(input.request.sort.direction.toUpperCase());
	const requiredJoinClause = buildRequiredJoinWhereClause(input.context.relationshipJoins);
	const filterClause = requiredJoinClause
		? sql`${filterWhereClause} and ${requiredJoinClause}`
		: filterWhereClause;

	const { pagination, items } = await executePaginatedQuery({
		direction,
		filterClause,
		sortExpression,
		resolvedFields,
		pagination: input.request.pagination,
		withCtes: [
			baseEntitiesCte,
			...latestEventJoinCtes,
			...latestRelationshipJoinCtes,
			joinedEntitiesCte,
		],
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
