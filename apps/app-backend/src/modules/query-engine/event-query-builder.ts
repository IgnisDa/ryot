import type { PreparedQueryContext } from "./context";
import { buildJoinedCte } from "./event-join-ctes";
import { buildEventFirstCte } from "./event-query-ctes";
import { executePaginatedQuery } from "./paginated-query-sql";
import {
	buildLatestEventJoinCtes,
	buildQueryFilterClause,
	buildQueryResolvedFields,
	buildQueryRuntime,
	buildQuerySortExpression,
	buildSortDirection,
} from "./query-builder-shared";
import { EVENT_FIRST_ENTITY_COLUMN_OVERRIDES, EVENT_CTE_ALIASES } from "./query-cte-shared";
import type { EventsQueryEngineRequest, QueryEngineEventsResponse } from "./schemas";

export const executeEventQuery = async (input: {
	userId: string;
	context: PreparedQueryContext;
	request: EventsQueryEngineRequest;
}): Promise<QueryEngineEventsResponse> => {
	const runtime = buildQueryRuntime({
		userId: input.userId,
		context: input.context,
		computedFields: input.request.computedFields,
		overrides: {
			eventSchemaMap: input.context.eventSchemaMap,
			entityColumnOverrides: EVENT_FIRST_ENTITY_COLUMN_OVERRIDES,
		},
	});
	const baseEventsCte = buildEventFirstCte({
		userId: input.userId,
		cteName: EVENT_CTE_ALIASES.base,
		eventSchemaSlugs: input.request.eventSchemas,
		entitySchemaIds: input.context.runtimeSchemas.map((s) => s.id),
	});
	const latestEventJoinCtes = buildLatestEventJoinCtes(input.userId, input.context.eventJoins);
	const joinedEventsCte = buildJoinedCte({
		entityIdColumn: "entity_id",
		baseCte: EVENT_CTE_ALIASES.base,
		cteName: EVENT_CTE_ALIASES.joined,
		eventJoins: input.context.eventJoins,
	});
	const filterClause = buildQueryFilterClause({
		runtime,
		alias: EVENT_CTE_ALIASES.joined,
		predicate: input.request.filter,
		computedFields: input.request.computedFields,
	});
	const sortExpression = buildQuerySortExpression({
		runtime,
		alias: EVENT_CTE_ALIASES.filtered,
		expression: input.request.sort.expression,
		computedFields: input.request.computedFields,
	});
	const resolvedFields = buildQueryResolvedFields({
		runtime,
		fields: input.request.fields,
		alias: EVENT_CTE_ALIASES.paginated,
		computedFields: input.request.computedFields,
	});
	const direction = buildSortDirection(input.request.sort.direction);

	const { pagination, items } = await executePaginatedQuery({
		direction,
		filterClause,
		sortExpression,
		resolvedFields,
		pagination: input.request.pagination,
		withCtes: [baseEventsCte, ...latestEventJoinCtes, joinedEventsCte],
		paginationConfig: {
			rowIdColumn: "id",
			countAlias: EVENT_CTE_ALIASES.count,
			sortedAlias: EVENT_CTE_ALIASES.sorted,
			filteredAlias: EVENT_CTE_ALIASES.filtered,
			joinedTableName: EVENT_CTE_ALIASES.joined,
			paginatedAlias: EVENT_CTE_ALIASES.paginated,
		},
	});

	return {
		mode: "events",
		data: {
			items,
			meta: { pagination, fieldOrder: input.request.fields.map((field) => field.key) },
		},
	} satisfies QueryEngineEventsResponse;
};
