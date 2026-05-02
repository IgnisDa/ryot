import { sql } from "drizzle-orm";
import { db } from "~/lib/db";
import type {
	QueryEngineEventJoinLike,
	QueryEngineReferenceContext,
} from "~/lib/views/reference";
import { buildResolvedFieldsExpression } from "./display-builder";
import { buildFilterWhereClause } from "./filter-builder";
import {
	buildBaseEntitiesCte,
	buildJoinedEntitiesCte,
	buildLatestEventJoinCte,
	buildPaginatedQuerySql,
	type QueryEngineSchemaRow,
} from "./query-ctes";
import type {
	EntityQueryEngineRequest,
	QueryEngineEntityResponse,
	QueryEngineItem,
} from "./schemas";
import { buildSortExpression } from "./sort-builder";

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

export const executePreparedQuery = async (input: {
	userId: string;
	request: EntityQueryEngineRequest;
	relationshipSchemaIds: string[];
	runtimeSchemas: QueryEngineSchemaRow[];
	eventJoins: QueryEngineEventJoinLike[];
	schemaMap: Map<string, QueryEngineSchemaRow>;
	eventJoinMap: Map<string, QueryEngineEventJoinLike>;
}): Promise<QueryEngineEntityResponse> => {
	const context: QueryEngineReferenceContext<
		QueryEngineSchemaRow,
		QueryEngineEventJoinLike
	> = {
		userId: input.userId,
		schemaMap: input.schemaMap,
		eventJoinMap: input.eventJoinMap,
	};
	const filterWhereClause = buildFilterWhereClause({
		context,
		alias: "joined_entities",
		predicate: input.request.filter,
		computedFields: input.request.computedFields,
	});
	const baseEntitiesCte = buildBaseEntitiesCte({
		userId: input.userId,
		relationshipSchemaIds: input.relationshipSchemaIds,
		entitySchemaIds: input.runtimeSchemas.map((schema) => schema.id),
	});
	const latestEventJoinCtes = input.eventJoins.map((join) => {
		return buildLatestEventJoinCte({ join, userId: input.userId });
	});
	const joinedEntitiesCte = buildJoinedEntitiesCte(input.eventJoins);
	const sortExpression = buildSortExpression({
		context,
		alias: "filtered_entities",
		expression: input.request.sort.expression,
		computedFields: input.request.computedFields,
	});
	const offset =
		(input.request.pagination.page - 1) * input.request.pagination.limit;
	const resolvedFields = buildResolvedFieldsExpression({
		context,
		alias: "paginated_entities",
		fields: input.request.fields,
		computedFields: input.request.computedFields,
	});
	const direction = sql.raw(input.request.sort.direction.toUpperCase());
	const filterClause = filterWhereClause ?? sql`true`;

	const dataResult = await db.execute<QueryRow>(
		buildPaginatedQuerySql({
			offset,
			direction,
			filterClause,
			sortExpression,
			resolvedFields,
			rowIdColumn: "id",
			countAlias: "entity_count",
			sortedAlias: "sorted_entities",
			filteredAlias: "filtered_entities",
			joinedTableName: "joined_entities",
			paginatedAlias: "paginated_entities",
			limit: input.request.pagination.limit,
			withCtes: [baseEntitiesCte, ...latestEventJoinCtes, joinedEntitiesCte],
		}),
	);

	const total = dataResult.rows[0]?.total ?? 0;
	const pagination = calculatePagination({
		total,
		page: input.request.pagination.page,
		limit: input.request.pagination.limit,
	});

	return {
		mode: "entities",
		data: {
			meta: { pagination },
			items: dataResult.rows.flatMap((row) => {
				const item = mapQueryRowToItem(row);
				return item ? [item] : [];
			}),
		},
	} satisfies QueryEngineEntityResponse;
};
