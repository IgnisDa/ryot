import { sql } from "drizzle-orm";
import { buildResolvedFieldsExpression } from "./display-builder";
import { buildFilterWhereClause } from "./filter-builder";
import { executePaginatedQuery } from "./paginated-query-sql";
import type { PreparedQueryContext } from "./preparer";
import {
	buildBaseEntitiesCte,
	buildJoinedEntitiesCte,
	buildLatestEventJoinCte,
} from "./query-ctes";
import type {
	EntityQueryEngineRequest,
	QueryEngineContext,
	QueryEngineEntityResponse,
} from "./schemas";
import { buildSortExpression } from "./sort-builder";

export const executePreparedQuery = async (input: {
	userId: string;
	context: PreparedQueryContext;
	request: EntityQueryEngineRequest;
}): Promise<QueryEngineEntityResponse> => {
	const queryContext: QueryEngineContext = {
		userId: input.userId,
		schemaMap: input.context.schemaMap,
		eventJoinMap: input.context.eventJoinMap,
	};
	const filterWhereClause = buildFilterWhereClause({
		context: queryContext,
		alias: "joined_entities",
		predicate: input.request.filter,
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
	const sortExpression = buildSortExpression({
		context: queryContext,
		alias: "filtered_entities",
		expression: input.request.sort.expression,
		computedFields: input.request.computedFields,
	});
	const resolvedFields = buildResolvedFieldsExpression({
		context: queryContext,
		alias: "paginated_entities",
		fields: input.request.fields,
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
			countAlias: "entity_count",
			sortedAlias: "sorted_entities",
			filteredAlias: "filtered_entities",
			joinedTableName: "joined_entities",
			paginatedAlias: "paginated_entities",
		},
	});

	return {
		mode: "entities",
		data: { meta: { pagination }, items },
	} satisfies QueryEngineEntityResponse;
};
