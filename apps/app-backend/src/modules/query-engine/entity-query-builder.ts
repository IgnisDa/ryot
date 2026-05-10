import type { PreparedQueryContext } from "./context";
import { buildBaseEntitiesCte } from "./entity-query-ctes";
import { buildJoinedEntitiesCte } from "./event-join-ctes";
import { executePaginatedQuery } from "./paginated-query-sql";
import {
	appendRequiredJoinFilterClause,
	buildLatestEventJoinCtes,
	buildLatestRelationshipJoinCtes,
	buildQueryFilterClause,
	buildQueryResolvedFields,
	buildQueryRuntime,
	buildQuerySortExpression,
	buildSortDirection,
} from "./query-builder-shared";
import { ENTITY_CTE_ALIASES } from "./query-cte-shared";
import type { EntityQueryEngineRequest, QueryEngineEntityResponse } from "./schemas";

export const executePreparedQuery = async (input: {
	userId: string;
	context: PreparedQueryContext;
	request: EntityQueryEngineRequest;
}): Promise<QueryEngineEntityResponse> => {
	const runtime = buildQueryRuntime({
		userId: input.userId,
		context: input.context,
		computedFields: input.request.computedFields,
	});
	const filterWhereClause = buildQueryFilterClause({
		runtime,
		predicate: input.request.filter,
		alias: ENTITY_CTE_ALIASES.joined,
		computedFields: input.request.computedFields,
	});
	const sortExpression = buildQuerySortExpression({
		runtime,
		alias: ENTITY_CTE_ALIASES.filtered,
		expression: input.request.sort.expression,
		computedFields: input.request.computedFields,
	});
	const baseEntitiesCte = buildBaseEntitiesCte({
		userId: input.userId,
		entitySchemaIds: input.context.runtimeSchemas.map((schema) => schema.id),
	});
	const latestEventJoinCtes = buildLatestEventJoinCtes(input.userId, input.context.eventJoins);
	const latestRelationshipJoinCtes = buildLatestRelationshipJoinCtes(
		input.userId,
		input.context.relationshipJoins,
	);
	const joinedEntitiesCte = buildJoinedEntitiesCte({
		eventJoins: input.context.eventJoins,
		relationshipJoins: input.context.relationshipJoins,
	});
	const resolvedFields = buildQueryResolvedFields({
		runtime,
		fields: input.request.fields,
		alias: ENTITY_CTE_ALIASES.paginated,
		computedFields: input.request.computedFields,
	});
	const direction = buildSortDirection(input.request.sort.direction);
	const filterClause = appendRequiredJoinFilterClause(
		filterWhereClause,
		input.context.relationshipJoins,
	);

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
		data: {
			items,
			meta: { pagination, fieldOrder: input.request.fields.map((field) => field.key) },
		},
	} satisfies QueryEngineEntityResponse;
};
