import { sql } from "drizzle-orm";
import { buildResolvedFieldsExpression } from "./display-builder";
import { createScalarExpressionCompiler } from "./expression-compiler";
import { createExpressionTypeResolver } from "./expression-type-resolver";
import { buildFilterWhereClause } from "./filter-builder";
import { executePaginatedQuery } from "./paginated-query-sql";
import { buildQueryContext, type PreparedQueryContext } from "./preparer";
import {
	buildEventFirstCte,
	buildJoinedCte,
	buildLatestEventJoinCte,
	EVENT_CTE_ALIASES,
	EVENT_FIRST_ENTITY_COLUMN_OVERRIDES,
} from "./query-ctes";
import type {
	EventsQueryEngineRequest,
	QueryEngineEventsResponse,
} from "./schemas";
import { buildSortExpression } from "./sort-builder";

export const executeEventQuery = async (input: {
	userId: string;
	context: PreparedQueryContext;
	request: EventsQueryEngineRequest;
}): Promise<QueryEngineEventsResponse> => {
	const queryContext = buildQueryContext(input.userId, input.context, {
		eventSchemaMap: input.context.eventSchemaMap,
		entityColumnOverrides: EVENT_FIRST_ENTITY_COLUMN_OVERRIDES,
	});
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

	const baseEventsCte = buildEventFirstCte({
		userId: input.userId,
		cteName: EVENT_CTE_ALIASES.base,
		eventSchemaSlugs: input.request.eventSchemas,
		entitySchemaIds: input.context.runtimeSchemas.map((s) => s.id),
	});
	const latestEventJoinCtes = input.context.eventJoins.map((join) => {
		return buildLatestEventJoinCte({ join, userId: input.userId });
	});
	const joinedEventsCte = buildJoinedCte({
		entityIdColumn: "entity_id",
		baseCte: EVENT_CTE_ALIASES.base,
		cteName: EVENT_CTE_ALIASES.joined,
		eventJoins: input.context.eventJoins,
	});
	const filterCompiler = createCompiler(EVENT_CTE_ALIASES.joined);
	const filterWhereClause = buildFilterWhereClause({
		context: queryContext,
		compiler: filterCompiler,
		predicate: input.request.filter,
		computedFields: input.request.computedFields,
	});
	const sortCompiler = createCompiler(EVENT_CTE_ALIASES.filtered);
	const sortExpression = buildSortExpression({
		context: queryContext,
		compiler: sortCompiler,
		expression: input.request.sort.expression,
		computedFields: input.request.computedFields,
	});
	const resolvedFields = buildResolvedFieldsExpression({
		getTypeInfo,
		context: queryContext,
		fields: input.request.fields,
		alias: EVENT_CTE_ALIASES.paginated,
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
			countAlias: EVENT_CTE_ALIASES.count,
			sortedAlias: EVENT_CTE_ALIASES.sorted,
			filteredAlias: EVENT_CTE_ALIASES.filtered,
			joinedTableName: EVENT_CTE_ALIASES.joined,
			paginatedAlias: EVENT_CTE_ALIASES.paginated,
		},
	});

	return {
		mode: "events",
		data: { meta: { pagination }, items },
	} satisfies QueryEngineEventsResponse;
};
