import { sql } from "drizzle-orm";
import { buildResolvedFieldsExpression } from "./display-builder";
import { buildFilterWhereClause } from "./filter-builder";
import type { PreparedQueryContext } from "./preparer";
import { executePaginatedQuery } from "./query-builder";
import {
	buildEventFirstCte,
	buildJoinedCte,
	buildLatestEventJoinCte,
	EVENT_FIRST_ENTITY_COLUMN_OVERRIDES,
} from "./query-ctes";
import type {
	EventsQueryEngineRequest,
	QueryEngineContext,
	QueryEngineEventsResponse,
} from "./schemas";
import { buildSortExpression } from "./sort-builder";

export const executeEventQuery = async (input: {
	userId: string;
	context: PreparedQueryContext;
	request: EventsQueryEngineRequest;
}): Promise<QueryEngineEventsResponse> => {
	const queryContext: QueryEngineContext = {
		userId: input.userId,
		schemaMap: input.context.schemaMap,
		eventJoinMap: input.context.eventJoinMap,
		eventSchemaMap: input.context.eventSchemaMap,
		entityColumnOverrides: EVENT_FIRST_ENTITY_COLUMN_OVERRIDES,
	};

	const baseEventsCte = buildEventFirstCte({
		userId: input.userId,
		cteName: "base_events",
		eventSchemaSlugs: input.request.eventSchemas,
		entitySchemaIds: input.context.runtimeSchemas.map((s) => s.id),
	});
	const latestEventJoinCtes = input.context.eventJoins.map((join) => {
		return buildLatestEventJoinCte({ join, userId: input.userId });
	});
	const joinedEventsCte = buildJoinedCte({
		baseCte: "base_events",
		cteName: "joined_events",
		entityIdColumn: "entity_id",
		eventJoins: input.context.eventJoins,
	});
	const filterWhereClause = buildFilterWhereClause({
		context: queryContext,
		alias: "joined_events",
		predicate: input.request.filter,
		computedFields: input.request.computedFields,
	});
	const sortExpression = buildSortExpression({
		context: queryContext,
		alias: "filtered_events",
		expression: input.request.sort.expression,
		computedFields: input.request.computedFields,
	});
	const resolvedFields = buildResolvedFieldsExpression({
		context: queryContext,
		alias: "paginated_events",
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
		withCtes: [baseEventsCte, ...latestEventJoinCtes, joinedEventsCte],
		paginationConfig: {
			rowIdColumn: "id",
			countAlias: "event_count",
			sortedAlias: "sorted_events",
			filteredAlias: "filtered_events",
			joinedTableName: "joined_events",
			paginatedAlias: "paginated_events",
		},
	});

	return {
		mode: "events",
		data: { meta: { pagination }, items },
	} satisfies QueryEngineEventsResponse;
};
