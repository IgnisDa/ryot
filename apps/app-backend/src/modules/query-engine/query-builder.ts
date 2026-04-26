import { sql } from "drizzle-orm";
import { db } from "~/lib/db";
import { buildResolvedFieldsExpression } from "./display-builder";
import { buildFilterWhereClause } from "./filter-builder";
import type { PreparedQueryContext } from "./preparer";
import {
	buildBaseEntitiesCte,
	buildJoinedEntitiesCte,
	buildLatestEventJoinCte,
	buildPaginatedQuerySql,
	type PaginationConfig,
} from "./query-ctes";
import type {
	EntityQueryEngineRequest,
	QueryEngineContext,
	QueryEngineEntityResponse,
	QueryEngineItem,
} from "./schemas";
import { buildSortExpression } from "./sort-builder";
import type { SqlExpression } from "./sql-expression-helpers";

export type QueryRow = {
	total: number;
	row_id: string | null;
	fields: QueryEngineItem | null;
};

type PaginationInput = {
	page: number;
	total: number;
	limit: number;
};

type PaginationResult = PaginationInput & {
	totalPages: number;
	hasNextPage: boolean;
	hasPreviousPage: boolean;
};

export const calculatePagination = (
	input: PaginationInput,
): PaginationResult => {
	const totalPages =
		input.total === 0 ? 0 : Math.ceil(input.total / input.limit);

	return {
		...input,
		totalPages,
		hasNextPage: input.page < totalPages,
		hasPreviousPage: totalPages > 0 && input.page > 1,
	};
};

export const mapQueryRowToItem = (row: QueryRow): QueryEngineItem | null => {
	if (row.row_id === null) {
		return null;
	}

	return row.fields ?? [];
};

export const executePaginatedQuery = async (input: {
	direction: SqlExpression;
	withCtes: SqlExpression[];
	filterClause: SqlExpression;
	sortExpression: SqlExpression;
	resolvedFields: SqlExpression;
	pagination: { page: number; limit: number };
	paginationConfig: Omit<PaginationConfig, "limit" | "offset">;
}): Promise<{
	items: QueryEngineItem[];
	pagination: ReturnType<typeof calculatePagination>;
}> => {
	const offset = (input.pagination.page - 1) * input.pagination.limit;
	const config: PaginationConfig = {
		offset,
		limit: input.pagination.limit,
		countAlias: input.paginationConfig.countAlias,
		rowIdColumn: input.paginationConfig.rowIdColumn,
		sortedAlias: input.paginationConfig.sortedAlias,
		filteredAlias: input.paginationConfig.filteredAlias,
		paginatedAlias: input.paginationConfig.paginatedAlias,
		joinedTableName: input.paginationConfig.joinedTableName,
	};
	const dataResult = await db.execute<QueryRow>(
		buildPaginatedQuerySql({
			...config,
			withCtes: input.withCtes,
			direction: input.direction,
			filterClause: input.filterClause,
			sortExpression: input.sortExpression,
			resolvedFields: input.resolvedFields,
		}),
	);
	const total = dataResult.rows[0]?.total ?? 0;
	const pagination = calculatePagination({
		total,
		page: input.pagination.page,
		limit: input.pagination.limit,
	});
	const items = dataResult.rows.flatMap((row) => {
		const item = mapQueryRowToItem(row);
		return item ? [item] : [];
	});
	return { pagination, items };
};

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
