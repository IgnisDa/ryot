import { sql } from "drizzle-orm";

import { db } from "~/lib/db";

import type { PaginatedQueryInput } from "./query-cte-shared";
import type { QueryEngineItem } from "./schemas";
import { sanitizeIdentifier } from "./sql-expression-helpers";

type QueryRow = {
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

export const calculatePagination = (input: PaginationInput): PaginationResult => {
	const totalPages = input.total === 0 ? 0 : Math.ceil(input.total / input.limit);

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

export const buildPaginatedQuerySql = (input: PaginatedQueryInput) => {
	sanitizeIdentifier(input.rowIdColumn, "column name");
	sanitizeIdentifier(input.countAlias, "CTE alias");
	sanitizeIdentifier(input.sortedAlias, "CTE alias");
	sanitizeIdentifier(input.filteredAlias, "CTE alias");
	sanitizeIdentifier(input.paginatedAlias, "CTE alias");
	sanitizeIdentifier(input.joinedTableName, "table name");
	const cteList = sql.join(input.withCtes, sql`, `);

	return sql`
		with
			${cteList},
			${sql.raw(input.filteredAlias)} as (
				select * from ${sql.raw(input.joinedTableName)} where ${input.filterClause}
			),
			${sql.raw(input.sortedAlias)} as (
				select
					${sql.raw(input.filteredAlias)}.*,
					count(*) over ()::integer as total,
					row_number() over (
						order by ${input.sortExpression} ${input.direction} nulls last, ${sql.raw(input.filteredAlias)}.id asc
					) as sort_index
				from ${sql.raw(input.filteredAlias)}
			),
			${sql.raw(input.countAlias)} as (
				select coalesce(max(total), 0)::integer as total
				from ${sql.raw(input.sortedAlias)}
			),
			${sql.raw(input.paginatedAlias)} as (
				select *
				from ${sql.raw(input.sortedAlias)}
				order by sort_index
				offset ${input.offset}
				limit ${input.limit}
			)
		select
			${sql.raw(input.paginatedAlias)}.${sql.raw(input.rowIdColumn)} as row_id,
			${sql.raw(input.countAlias)}.total,
			${input.resolvedFields} as fields
		from ${sql.raw(input.countAlias)}
		left join ${sql.raw(input.paginatedAlias)} on true
		order by sort_index
	`;
};

export const executePaginatedQuery = async (input: {
	direction: PaginatedQueryInput["direction"];
	withCtes: PaginatedQueryInput["withCtes"];
	filterClause: PaginatedQueryInput["filterClause"];
	sortExpression: PaginatedQueryInput["sortExpression"];
	resolvedFields: PaginatedQueryInput["resolvedFields"];
	pagination: { page: number; limit: number };
	paginationConfig: Omit<
		PaginatedQueryInput,
		| "direction"
		| "withCtes"
		| "filterClause"
		| "sortExpression"
		| "resolvedFields"
		| "limit"
		| "offset"
	>;
}): Promise<{
	items: QueryEngineItem[];
	pagination: ReturnType<typeof calculatePagination>;
}> => {
	const offset = (input.pagination.page - 1) * input.pagination.limit;
	const dataResult = await db.execute<QueryRow>(
		buildPaginatedQuerySql({
			...input.paginationConfig,
			offset,
			limit: input.pagination.limit,
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
