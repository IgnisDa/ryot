import { sql } from "drizzle-orm";
import { Effect } from "effect";

import type { CurrentDb } from "~/lib/db";
import type { DbError } from "~/lib/errors";
import type { EventsQueryRequest } from "~/lib/query-language";

import type { PreparedQueryContext } from "./context";
import { buildJoinedCte } from "./event-join-ctes";
import { buildEventFirstCte } from "./event-query-ctes";
import { executePaginatedQuery } from "./paginated-query-sql";
import type { calculatePagination } from "./paginated-query-sql";
import {
	buildLatestEventJoinCtes,
	buildQueryFilterClause,
	buildQueryResolvedFields,
	buildQueryRuntime,
	buildQuerySortExpression,
	buildSortDirection,
} from "./query-builder-shared";
import { EVENT_FIRST_ENTITY_COLUMN_OVERRIDES, EVENT_CTE_ALIASES } from "./query-cte-shared";

export const executeEventQuery = (input: {
	userId: string;
	context: PreparedQueryContext;
	request: EventsQueryRequest;
}): Effect.Effect<
	{
		mode: "events";
		data: {
			items: Readonly<Record<string, { kind: string; value: unknown }>>[];
			meta: {
				pagination: ReturnType<typeof calculatePagination>;
				fieldOrder: string[];
			};
		};
	},
	DbError,
	CurrentDb
> =>
	Effect.gen(function* () {
		const sort = input.request.sort;
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

		const defaultSortExpression = sort
			? buildQuerySortExpression({
					runtime,
					alias: EVENT_CTE_ALIASES.filtered,
					expression: sort.expression,
					computedFields: input.request.computedFields,
				})
			: sql`${sql.raw(EVENT_CTE_ALIASES.filtered)}.occurred_at`;

		const filterClause = buildQueryFilterClause({
			runtime,
			alias: EVENT_CTE_ALIASES.joined,
			predicate: input.request.filter,
			computedFields: input.request.computedFields,
		});
		const resolvedFields = buildQueryResolvedFields({
			runtime,
			fields: input.request.fields,
			alias: EVENT_CTE_ALIASES.paginated,
			computedFields: input.request.computedFields,
		});
		const direction = sort ? buildSortDirection(sort.direction) : sql`DESC`;

		const { pagination, items } = yield* executePaginatedQuery({
			direction,
			filterClause,
			resolvedFields,
			sortExpression: defaultSortExpression,
			pagination: input.request.pagination,
			withCtes: [baseEventsCte, ...latestEventJoinCtes, joinedEventsCte],
			paginationConfig: {
				rowIdColumn: "id",
				countAlias: EVENT_CTE_ALIASES.count,
				sortedAlias: EVENT_CTE_ALIASES.sorted,
				filteredAlias: EVENT_CTE_ALIASES.filtered,
				joinedTableName: EVENT_CTE_ALIASES.joined,
				paginatedAlias: EVENT_CTE_ALIASES.paginated,
				tiebreakerExpressions: sql`${sql.raw(EVENT_CTE_ALIASES.filtered)}.created_at desc nulls last, ${sql.raw(EVENT_CTE_ALIASES.filtered)}.id desc`,
			},
		});

		return {
			mode: "events" as const,
			data: {
				items,
				meta: { pagination, fieldOrder: input.request.fields.map((field) => field.key) },
			},
		};
	});
