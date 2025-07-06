import { sql } from "drizzle-orm";
import { db } from "~/lib/db";
import type {
	QueryEngineEventJoinLike,
	QueryEngineEventSchemaLike,
	QueryEngineReferenceContext,
} from "~/lib/views/reference";
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
	EVENT_FIRST_ENTITY_COLUMN_OVERRIDES,
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
	const context: QueryEngineReferenceContext<
		QueryEngineSchemaRow,
		QueryEngineEventJoinLike
	> = {
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

	const dataResult = await db.execute<QueryRow>(sql`
		with
			${baseEventsCte}${latestEventJoinCtes.length ? sql`, ${sql.join(latestEventJoinCtes, sql`, `)}` : sql``},
			${joinedEventsCte},
			filtered_events as (
				select *
				from joined_events
				where ${filterClause}
			),
			sorted_events as (
				select
					filtered_events.*,
					count(*) over ()::integer as total,
					row_number() over (
						order by ${sortExpression} ${direction} nulls last, filtered_events.id asc
					) as sort_index
				from filtered_events
			),
			event_count as (
				select coalesce(max(total), 0)::integer as total
				from sorted_events
			),
			paginated_events as (
				select *
				from sorted_events
				order by sort_index
				offset ${offset}
				limit ${input.request.pagination.limit}
			)
		select
			paginated_events.id as row_id,
			event_count.total,
			${resolvedFields} as fields
		from event_count
		left join paginated_events on true
		order by sort_index
	`);

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
