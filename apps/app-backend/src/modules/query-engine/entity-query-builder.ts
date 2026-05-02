import { sql } from "drizzle-orm";
import { Effect } from "effect";

import type { CurrentDb } from "#lib/db";
import type { DbError } from "#lib/errors";
import type { EntitiesQueryRequest } from "#lib/query-language";

import type { PreparedQueryContext } from "./context";
import { buildBaseEntitiesCte } from "./entity-query-ctes";
import { buildJoinedEntitiesCte } from "./event-join-ctes";
import type { calculatePagination } from "./paginated-query-sql";
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
import {
	getEventJoinColumnName,
	type SqlExpression,
	sanitizeIdentifier,
} from "./sql-expression-helpers";

const buildEventJoinOccurredAtTiebreaker = (
	expression: NonNullable<EntitiesQueryRequest["sort"]>["expression"],
): SqlExpression | undefined => {
	if (expression.type !== "reference") {
		return undefined;
	}

	const { reference } = expression;
	if (
		reference.type !== "event-join" ||
		reference.path.length !== 1 ||
		reference.path[0] !== "occurredAt"
	) {
		return undefined;
	}

	const joinColumnName = getEventJoinColumnName(reference.joinKey);
	sanitizeIdentifier(joinColumnName, "event join column");
	const joinColumn = sql`${sql.raw(ENTITY_CTE_ALIASES.filtered)}.${sql.raw(joinColumnName)}`;

	return sql`(${joinColumn} ->> ${"createdAt"})::timestamptz desc nulls last, (${joinColumn} ->> ${"id"}) desc nulls last`;
};

export const executePreparedQuery = (input: {
	userId: string;
	context: PreparedQueryContext;
	request: EntitiesQueryRequest;
}): Effect.Effect<
	{
		mode: "entities";
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
		});

		const defaultSortExpression = sort
			? buildQuerySortExpression({
					runtime,
					alias: ENTITY_CTE_ALIASES.filtered,
					expression: sort.expression,
					computedFields: input.request.computedFields,
				})
			: sql`${sql.raw(ENTITY_CTE_ALIASES.filtered)}.created_at`;

		const filterWhereClause = buildQueryFilterClause({
			runtime,
			predicate: input.request.filter,
			alias: ENTITY_CTE_ALIASES.joined,
			computedFields: input.request.computedFields,
		});
		const baseEntitiesCte = buildBaseEntitiesCte({
			userId: input.userId,
			entitySchemaIds: input.context.runtimeSchemas.map((s) => s.id),
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
		const direction = sort ? buildSortDirection(sort.direction) : sql`ASC`;
		const filterClause = appendRequiredJoinFilterClause(
			filterWhereClause,
			input.context.relationshipJoins,
		);
		const tiebreakerExpressions = sort
			? buildEventJoinOccurredAtTiebreaker(sort.expression)
			: undefined;

		const { pagination, items } = yield* executePaginatedQuery({
			direction,
			filterClause,
			resolvedFields,
			pagination: input.request.pagination,
			sortExpression: defaultSortExpression,
			withCtes: [
				baseEntitiesCte,
				...latestEventJoinCtes,
				...latestRelationshipJoinCtes,
				joinedEntitiesCte,
			],
			paginationConfig: {
				rowIdColumn: "id",
				tiebreakerExpressions,
				countAlias: ENTITY_CTE_ALIASES.count,
				sortedAlias: ENTITY_CTE_ALIASES.sorted,
				filteredAlias: ENTITY_CTE_ALIASES.filtered,
				joinedTableName: ENTITY_CTE_ALIASES.joined,
				paginatedAlias: ENTITY_CTE_ALIASES.paginated,
			},
		});

		return {
			mode: "entities" as const,
			data: {
				items,
				meta: { pagination, fieldOrder: input.request.fields.map((field) => field.key) },
			},
		};
	});
