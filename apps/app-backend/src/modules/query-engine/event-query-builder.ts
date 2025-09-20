import { sql } from "drizzle-orm";
import { db } from "~/lib/db";
import type {
	QueryEngineEventJoinLike,
	QueryEngineEventSchemaLike,
} from "~/lib/views/reference";
import type { QueryEngineContext } from "./context";
import { buildResolvedFieldsExpression } from "./display-builder";
import { buildFilterWhereClause } from "./filter-builder";
import {
	calculatePagination,
	mapQueryRowToItem,
	type QueryRow,
} from "./query-builder";
import {
	buildEventFirstCte,
	buildJoinedCte,
	buildLatestEventJoinCte,
	buildPaginatedQuerySql,
	EVENT_FIRST_ENTITY_COLUMN_OVERRIDES,
	type PaginationConfig,
	type QueryEngineSchemaRow,
} from "./query-ctes";
import type {
	EventsQueryEngineRequest,
	QueryEngineEventsResponse,
} from "./schemas";
import { buildSortExpression } from "./sort-builder";

export const executeEventQuery = async (input: {
	userId: string;
	request: EventsQueryEngineRequest;
	runtimeSchemas: QueryEngineSchemaRow[];
	eventJoins: QueryEngineEventJoinLike[];
	schemaMap: Map<string, QueryEngineSchemaRow>;
	eventJoinMap: Map<string, QueryEngineEventJoinLike>;
	eventSchemaMap: Map<string, QueryEngineEventSchemaLike[]>;
}): Promise<QueryEngineEventsResponse> => {
	const context: QueryEngineContext = {
		userId: input.userId,
		schemaMap: input.schemaMap,
		eventJoinMap: input.eventJoinMap,
		eventSchemaMap: input.eventSchemaMap,
		entityColumnOverrides: EVENT_FIRST_ENTITY_COLUMN_OVERRIDES,
	};

	const baseEventsCte = buildEventFirstCte({
		cteName: "base_events",
		userId: input.userId,
		entitySchemaIds: input.runtimeSchemas.map((s) => s.id),
		eventSchemaSlugs: input.request.eventSchemas,
	});
	const latestEventJoinCtes = input.eventJoins.map((join) => {
		return buildLatestEventJoinCte({ join, userId: input.userId });
	});
	const joinedEventsCte = buildJoinedCte({
		baseCte: "base_events",
		cteName: "joined_events",
		entityIdColumn: "entity_id",
		eventJoins: input.eventJoins,
	});
	const filterWhereClause = buildFilterWhereClause({
		context,
		alias: "joined_events",
		predicate: input.request.filter,
		computedFields: input.request.computedFields,
	});
	const sortExpression = buildSortExpression({
		context,
		alias: "filtered_events",
		expression: input.request.sort.expression,
		computedFields: input.request.computedFields,
	});
	const resolvedFields = buildResolvedFieldsExpression({
		context,
		alias: "paginated_events",
		fields: input.request.fields,
		computedFields: input.request.computedFields,
	});
	const direction = sql.raw(input.request.sort.direction.toUpperCase());
	const filterClause = filterWhereClause ?? sql`true`;
	const offset =
		(input.request.pagination.page - 1) * input.request.pagination.limit;

	const paginationConfig: PaginationConfig = {
		offset,
		rowIdColumn: "id",
		countAlias: "event_count",
		sortedAlias: "sorted_events",
		filteredAlias: "filtered_events",
		joinedTableName: "joined_events",
		paginatedAlias: "paginated_events",
		limit: input.request.pagination.limit,
	};

	const dataResult = await db.execute<QueryRow>(
		buildPaginatedQuerySql({
			...paginationConfig,
			direction,
			filterClause,
			sortExpression,
			resolvedFields,
			withCtes: [baseEventsCte, ...latestEventJoinCtes, joinedEventsCte],
		}),
	);

	const total = dataResult.rows[0]?.total ?? 0;
	const pagination = calculatePagination({
		total,
		page: input.request.pagination.page,
		limit: input.request.pagination.limit,
	});

	return {
		mode: "events",
		data: {
			meta: { pagination },
			items: dataResult.rows.flatMap((row) => {
				const item = mapQueryRowToItem(row);
				return item ? [item] : [];
			}),
		},
	} satisfies QueryEngineEventsResponse;
};
