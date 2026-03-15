import type {
	FieldValue,
	NamedQuery,
	Predicate,
	RowsResult,
	ScalarExpression,
} from "@ryot/contract/modules/ryotql/language";
import { sql } from "drizzle-orm";
import { Effect } from "effect";

import { CurrentDb, dbEffect } from "#lib/infrastructure/db/service";

import {
	getCatalogTable,
	resolveCatalogField,
	type CatalogFieldKind,
	type CatalogTable,
} from "./catalog";

type SqlFragment = ReturnType<typeof sql>;
type CompileScope = ReadonlyMap<string, CompileTable>;
type CompileTable = { readonly alias: string; readonly table: CatalogTable };

const identifier = (value: string): SqlFragment => sql.raw(`"${value}"`);

const requireTable = (name: string) => {
	const table = getCatalogTable(name);
	if (!table) {
		throw new Error(`RyotQL compiler received unknown table '${name}'`);
	}
	return table;
};

const requireCompileTable = (scope: CompileScope, alias: string) => {
	const table = scope.get(alias);
	if (!table) {
		throw new Error(`RyotQL compiler received unknown alias '${alias}'`);
	}
	return table;
};

const expressionKind = (expr: ScalarExpression, scope: CompileScope): CatalogFieldKind | "null" => {
	if (expr.type === "literal") {
		if (expr.value === null) {
			return "null";
		}
		if (typeof expr.value === "boolean") {
			return "boolean";
		}
		if (typeof expr.value === "number") {
			return "number";
		}
		if (typeof expr.value === "string") {
			return "text";
		}
		return "json";
	}
	const compileTable = requireCompileTable(scope, expr.tableAlias);
	const field = resolveCatalogField(compileTable.table, expr.field);
	if (!field) {
		throw new Error(`RyotQL compiler received unknown field '${expr.field}'`);
	}
	return field.kind;
};

const compileExpression = (expr: ScalarExpression, scope: CompileScope): SqlFragment => {
	if (expr.type === "literal") {
		return sql`${expr.value}`;
	}
	const compileTable = requireCompileTable(scope, expr.tableAlias);
	const field = resolveCatalogField(compileTable.table, expr.field);
	if (!field) {
		throw new Error(`RyotQL compiler received unknown field '${expr.field}'`);
	}
	return field.resolve(compileTable.alias);
};

const compileComparableExpression = (
	expr: ScalarExpression,
	scope: CompileScope,
	textComparison: boolean,
) => {
	const compiled = compileExpression(expr, scope);
	return textComparison && expressionKind(expr, scope) === "text"
		? sql`${compiled} COLLATE "C"`
		: compiled;
};

const compilePredicate = (predicate: Predicate, scope: CompileScope): SqlFragment => {
	if (predicate.type === "comparison") {
		const textComparison =
			expressionKind(predicate.left, scope) === "text" ||
			expressionKind(predicate.right, scope) === "text";
		return sql`COALESCE(${compileComparableExpression(predicate.left, scope, textComparison)} = ${compileComparableExpression(predicate.right, scope, textComparison)}, false)`;
	}
	if (predicate.values.length === 0) {
		return sql`false`;
	}
	const textComparison = expressionKind(predicate.expr, scope) === "text";
	return sql`COALESCE(${compileComparableExpression(predicate.expr, scope, textComparison)} IN (${sql.join(
		predicate.values.map((value) => compileComparableExpression(value, scope, textComparison)),
		sql`, `,
	)}), false)`;
};

const authorizedTable = (table: CatalogTable, userId: string): SqlFragment =>
	sql`(SELECT * FROM ${sql.raw(table.name)} WHERE (${sql.raw(table.userIdColumn)} = ${userId} OR ${sql.raw(table.userIdColumn)} IS NULL))`;

const outputKind = (expr: ScalarExpression, scope: CompileScope): SqlFragment => {
	const kind = expressionKind(expr, scope);
	if (kind === "null") {
		return sql`'null'`;
	}
	return sql`CASE WHEN ${compileExpression(expr, scope)} IS NULL THEN 'null' ELSE ${kind} END`;
};

const buildScope = (query: NamedQuery) => {
	const root = requireTable(query.from.table);
	const scope = new Map<string, CompileTable>([[query.from.alias, { alias: "t0", table: root }]]);
	(query.joins ?? []).forEach((join, index) => {
		scope.set(join.table.alias, { alias: `t${index + 1}`, table: requireTable(join.table.table) });
	});
	return scope;
};

const querySetSql = (query: NamedQuery, userId: string, scope: CompileScope): SqlFragment => {
	const root = requireCompileTable(scope, query.from.alias);
	const joins = (query.joins ?? []).map((join) => {
		const joined = requireCompileTable(scope, join.table.alias);
		const joinType = join.type === "inner" ? sql`INNER JOIN` : sql`LEFT JOIN`;
		return sql`${joinType} ${authorizedTable(joined.table, userId)} ${sql.raw(joined.alias)} ON ${compilePredicate(join.on, scope)}`;
	});
	return sql`
		FROM ${authorizedTable(root.table, userId)} ${sql.raw(root.alias)}
		${sql.join(joins, sql` `)}
		${query.where ? sql`WHERE ${compilePredicate(query.where, scope)}` : sql``}
	`;
};

const isRootPrimaryKeyOrder = (expr: ScalarExpression, query: NamedQuery, root: CatalogTable) =>
	expr.type === "column" && expr.tableAlias === query.from.alias && expr.field === root.primaryKey;

const orderSql = (
	orders: readonly {
		readonly direction: "asc" | "desc";
		readonly kind: CatalogFieldKind | "null";
	}[],
) =>
	sql.join(
		orders.map((order, index) => {
			const collation = order.kind === "text" ? sql` COLLATE "C"` : sql``;
			const direction = order.direction === "asc" ? sql`ASC` : sql`DESC`;
			return sql`${identifier(`o${index}`)}${collation} ${direction} NULLS LAST`;
		}),
		sql`, `,
	);

const compileRowsQuery = (query: NamedQuery, userId: string): SqlFragment => {
	const scope = buildScope(query);
	const root = requireTable(query.from.table);
	const rootKey = { field: root.primaryKey, type: "column" as const, tableAlias: query.from.alias };
	const requestedOrder = query.output.orderBy;
	const orders = requestedOrder.some((order) => isRootPrimaryKeyOrder(order.expr, query, root))
		? requestedOrder
		: [...requestedOrder, { direction: "asc" as const, expr: rootKey }];
	const orderMetadata = orders.map((order) => ({
		direction: order.direction,
		kind: expressionKind(order.expr, scope),
	}));
	const fieldColumns = query.output.fields.flatMap((field, index) => [
		sql`${compileExpression(field.expr, scope)} AS ${identifier(`f${index}v`)}`,
		sql`${outputKind(field.expr, scope)} AS ${identifier(`f${index}k`)}`,
	]);
	const orderColumns = orders.map(
		(order, index) => sql`${compileExpression(order.expr, scope)} AS ${identifier(`o${index}`)}`,
	);
	const columns = [...fieldColumns, ...orderColumns, sql`true AS "rowPresent"`];
	const pagination = query.output.pagination;
	const offset = (pagination.page - 1) * pagination.limit;
	const ordering = orderSql(orderMetadata);

	return sql`
		WITH "queryRows" AS (
			SELECT ${sql.join(columns, sql`, `)}
			${querySetSql(query, userId, scope)}
		), "pageRows" AS (
			SELECT * FROM "queryRows"
			ORDER BY ${ordering}
			LIMIT ${pagination.limit} OFFSET ${offset}
		)
		SELECT "pageRows".*, "queryTotal"."totalCount"
		FROM (SELECT COUNT(*)::integer AS "totalCount" FROM "queryRows") "queryTotal"
		LEFT JOIN "pageRows" ON true
		ORDER BY ${ordering}
	`;
};

const normalizeValue = (value: unknown, kind: FieldValue["kind"]) =>
	kind === "date" && value instanceof Date ? value.toISOString() : value;

const isFieldKind = (value: unknown): value is FieldValue["kind"] =>
	value === "boolean" ||
	value === "date" ||
	value === "json" ||
	value === "null" ||
	value === "number" ||
	value === "text";

export const executeNamedQuery = Effect.fn("executeRyotQLNamedQuery")(function* (
	userId: string,
	query: NamedQuery,
) {
	const db = yield* CurrentDb;
	const raw = yield* dbEffect(() => db.execute(compileRowsQuery(query, userId)));
	const rows = raw.rows as readonly Record<string, unknown>[];
	const first = rows[0];
	const total = first ? Number(first["totalCount"]) : 0;
	const items = rows.flatMap((row) => {
		if (row["rowPresent"] !== true) {
			return [];
		}
		const fields = query.output.fields.map((field, index) => {
			const kind = row[`f${index}k`];
			if (!isFieldKind(kind)) {
				throw new Error(`RyotQL received an invalid field kind for '${field.key}'`);
			}
			return [field.key, { kind, value: normalizeValue(row[`f${index}v`], kind) }] as const;
		});
		return [Object.fromEntries(fields)];
	});
	const { page, limit } = query.output.pagination;
	return {
		items,
		type: "rows",
		pageInfo: { page, limit, total, hasMore: (page - 1) * limit + items.length < total },
	} satisfies RowsResult;
});
