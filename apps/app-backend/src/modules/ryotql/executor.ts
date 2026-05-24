import type {
	FieldValue,
	Include,
	IncludeResult,
	NamedQuery,
	Predicate,
	RowItem,
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
type QuerySet = Pick<NamedQuery, "from" | "joins" | "where"> | Include;
type CompileTable = {
	readonly alias: string;
	readonly table: CatalogTable;
	readonly language: string | null;
};

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
	if (expr.type === "cast") {
		return expr.target;
	}
	if (expr.type === "jsonPath") {
		return "json";
	}
	if (expr.type === "coalesce") {
		const kinds = expr.values.map((value) => expressionKind(value, scope));
		const nonNullKinds = kinds.filter((kind) => kind !== "null");
		const first = nonNullKinds[0];
		return first && nonNullKinds.every((kind) => kind === first) ? first : "json";
	}
	const compileTable = requireCompileTable(scope, expr.tableAlias);
	const field = resolveCatalogField(compileTable.table, expr.field);
	if (!field) {
		throw new Error(`RyotQL compiler received unknown field '${expr.field}'`);
	}
	return field.kind;
};

const compileLiteral = (expr: Extract<ScalarExpression, { type: "literal" }>): SqlFragment => {
	if (expr.value === null || expr.value === undefined) {
		return sql`NULL`;
	}
	if (typeof expr.value === "boolean") {
		return sql`${expr.value}::boolean`;
	}
	if (typeof expr.value === "number") {
		return sql`${expr.value}::double precision`;
	}
	if (typeof expr.value === "string") {
		return sql`${expr.value}::text`;
	}
	const serialized = JSON.stringify(expr.value);
	return sql`${serialized}::jsonb`;
};

const castSqlType = (target: Extract<ScalarExpression, { type: "cast" }>["target"]) => {
	if (target === "number") {
		return "double precision";
	}
	if (target === "date") {
		return "timestamp with time zone";
	}
	return target === "json" ? "jsonb" : target;
};

const typedNull = (target: Extract<ScalarExpression, { type: "cast" }>["target"]) =>
	sql.raw(`NULL::${castSqlType(target)}`);

const safeInputValid = (
	value: SqlFragment,
	target: Extract<ScalarExpression, { type: "cast" }>["target"],
) => {
	const valid = sql`pg_input_is_valid(${value}, ${castSqlType(target)})`;
	if (target === "number") {
		return sql`(${valid} AND lower(btrim(${value})) NOT IN ('nan', 'infinity', '+infinity', '-infinity', 'inf', '+inf', '-inf'))`;
	}
	if (target === "date") {
		return sql`(${valid} AND lower(btrim(${value})) NOT IN ('infinity', '+infinity', '-infinity'))`;
	}
	return valid;
};

const compileJsonValue = (expr: ScalarExpression, scope: CompileScope): SqlFragment => {
	const compiled = compileExpression(expr, scope);
	const kind = expressionKind(expr, scope);
	if (kind === "json") {
		return sql`NULLIF(${compiled}, 'null'::jsonb)`;
	}
	if (kind === "null") {
		return sql`NULL::jsonb`;
	}
	return sql`to_jsonb(${compiled})`;
};

const compileCast = (
	expr: Extract<ScalarExpression, { type: "cast" }>,
	scope: CompileScope,
): SqlFragment => {
	const sourceKind = expressionKind(expr.expr, scope);
	if (expr.target === "json") {
		return compileJsonValue(expr.expr, scope);
	}
	const source = compileExpression(expr.expr, scope);
	if (sourceKind === expr.target) {
		return source;
	}
	if (sourceKind === "json") {
		const json = compileJsonValue(expr.expr, scope);
		const text = sql`(${json} #>> '{}')`;
		if (expr.target === "text") {
			return sql`CASE WHEN jsonb_typeof(${json}) = 'string' THEN ${text} END`;
		}
		let jsonType = "boolean";
		if (expr.target === "number") {
			jsonType = "number";
		} else if (expr.target === "date") {
			jsonType = "string";
		}
		const sqlType = castSqlType(expr.target);
		const valid = expr.target === "boolean" ? sql`true` : safeInputValid(text, expr.target);
		return sql`(CASE WHEN jsonb_typeof(${json}) = ${jsonType} AND ${valid} THEN ${text} END)::${sql.raw(sqlType)}`;
	}
	if (sourceKind === "text" && expr.target !== "text") {
		const sqlType = castSqlType(expr.target);
		return sql`(CASE WHEN ${safeInputValid(source, expr.target)} THEN ${source} END)::${sql.raw(sqlType)}`;
	}
	return typedNull(expr.target);
};

const compileExpression = (expr: ScalarExpression, scope: CompileScope): SqlFragment => {
	if (expr.type === "literal") {
		return compileLiteral(expr);
	}
	if (expr.type === "cast") {
		return compileCast(expr, scope);
	}
	if (expr.type === "jsonPath") {
		return sql`NULLIF(jsonb_extract_path(${compileJsonValue(expr.expr, scope)}, ${sql.join(
			expr.path.map((segment) => sql`${String(segment)}`),
			sql`, `,
		)}), 'null'::jsonb)`;
	}
	if (expr.type === "coalesce") {
		const kind = expressionKind(expr, scope);
		return kind === "json"
			? sql`COALESCE(${sql.join(
					expr.values.map((value) => compileJsonValue(value, scope)),
					sql`, `,
				)})`
			: sql`COALESCE(${sql.join(
					expr.values.map((value) => compileExpression(value, scope)),
					sql`, `,
				)})`;
	}
	const compileTable = requireCompileTable(scope, expr.tableAlias);
	const field = resolveCatalogField(compileTable.table, expr.field);
	if (!field) {
		throw new Error(`RyotQL compiler received unknown field '${expr.field}'`);
	}
	return field.resolve({ language: compileTable.language, sqlAlias: compileTable.alias });
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
		const operators = {
			eq: sql`=`,
			gt: sql`>`,
			lt: sql`<`,
			gte: sql`>=`,
			lte: sql`<=`,
			neq: sql`<>`,
		};
		const operator = operators[predicate.operator];
		if (
			expressionKind(predicate.left, scope) === "json" &&
			expressionKind(predicate.right, scope) === "json"
		) {
			return sql`COALESCE(${compileJsonValue(predicate.left, scope)} ${operator} ${compileJsonValue(predicate.right, scope)}, false)`;
		}
		const textComparison =
			expressionKind(predicate.left, scope) === "text" ||
			expressionKind(predicate.right, scope) === "text";
		return sql`COALESCE(${compileComparableExpression(predicate.left, scope, textComparison)} ${operator} ${compileComparableExpression(predicate.right, scope, textComparison)}, false)`;
	}
	if (predicate.type === "and" || predicate.type === "or") {
		if (predicate.predicates.length === 0) {
			return predicate.type === "and" ? sql`true` : sql`false`;
		}
		const separator = predicate.type === "and" ? sql` AND ` : sql` OR `;
		return sql`(${sql.join(
			predicate.predicates.map((value) => compilePredicate(value, scope)),
			separator,
		)})`;
	}
	if (predicate.type === "not") {
		return sql`(NOT ${compilePredicate(predicate.predicate, scope)})`;
	}
	if (predicate.type === "isNull" || predicate.type === "isNotNull") {
		const operator = predicate.type === "isNull" ? sql`IS NULL` : sql`IS NOT NULL`;
		return sql`(${compileExpression(predicate.expr, scope)} ${operator})`;
	}
	if (predicate.type === "contains") {
		if (expressionKind(predicate.left, scope) === "json") {
			return sql`COALESCE(${compileJsonValue(predicate.left, scope)} @> ${compileJsonValue(predicate.right, scope)}, false)`;
		}
		const left = compileExpression(predicate.left, scope);
		const right = compileExpression(predicate.right, scope);
		const pattern =
			predicate.right.type === "literal" && typeof predicate.right.value === "string"
				? sql`${`%${predicate.right.value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_")}%`}`
				: sql`('%' || replace(replace(replace(${right}, '\\', '\\\\'), '%', '\\%'), '_', '\\_') || '%')`;
		return sql`COALESCE(${left} COLLATE "C" ILIKE ${pattern}, false)`;
	}
	if (predicate.values.length === 0) {
		return sql`false`;
	}
	const kind = expressionKind(predicate.expr, scope);
	if (kind === "json") {
		return sql`COALESCE(${compileJsonValue(predicate.expr, scope)} IN (${sql.join(
			predicate.values.map((value) => compileJsonValue(value, scope)),
			sql`, `,
		)}), false)`;
	}
	const textComparison = kind === "text";
	return sql`COALESCE(${compileComparableExpression(predicate.expr, scope, textComparison)} IN (${sql.join(
		predicate.values.map((value) => compileComparableExpression(value, scope, textComparison)),
		sql`, `,
	)}), false)`;
};

const authorizedTable = (table: CatalogTable, userId: string): SqlFragment =>
	sql`(SELECT * FROM ${sql.raw(table.name)} WHERE (${sql.raw(table.userIdColumn)} = ${userId} OR ${sql.raw(table.userIdColumn)} IS NULL))`;

const outputKind = (expr: ScalarExpression, scope: CompileScope): SqlFragment => {
	if (expr.type === "jsonPath") {
		const value = compileExpression(expr, scope);
		return sql`CASE jsonb_typeof(${value}) WHEN 'string' THEN 'text' WHEN 'number' THEN 'number' WHEN 'boolean' THEN 'boolean' WHEN 'object' THEN 'json' WHEN 'array' THEN 'json' ELSE 'null' END`;
	}
	if (expr.type === "coalesce" && expressionKind(expr, scope) === "json") {
		const cases = expr.values.map((value) => {
			const json = compileJsonValue(value, scope);
			return sql`WHEN ${json} IS NOT NULL THEN ${outputKind(value, scope)}`;
		});
		return sql`CASE ${sql.join(cases, sql` `)} ELSE 'null' END`;
	}
	const kind = expressionKind(expr, scope);
	if (kind === "null") {
		return sql`'null'`;
	}
	return sql`CASE WHEN ${compileExpression(expr, scope)} IS NULL THEN 'null' ELSE ${sql.raw(`'${kind}'`)} END`;
};

const buildScope = (
	query: QuerySet,
	language: string | null,
	prefix: string,
	ancestors: CompileScope = new Map(),
) => {
	const root = requireTable(query.from.table);
	const scope = new Map(ancestors);
	scope.set(query.from.alias, { language, alias: `${prefix}t0`, table: root });
	(query.joins ?? []).forEach((join, index) => {
		scope.set(join.table.alias, {
			language,
			alias: `${prefix}t${index + 1}`,
			table: requireTable(join.table.table),
		});
	});
	return scope;
};

const querySetSql = (query: QuerySet, userId: string, scope: CompileScope): SqlFragment => {
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

const isPrimaryKeyOrder = (expr: ScalarExpression, alias: string, table: CatalogTable) =>
	expr.type === "column" && expr.tableAlias === alias && expr.field === table.primaryKey;

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

const expressionOrderSql = (
	orders: readonly { readonly expr: ScalarExpression; readonly direction: "asc" | "desc" }[],
	scope: CompileScope,
) =>
	sql.join(
		orders.map((order) => {
			const expression = compileExpression(order.expr, scope);
			const collation = expressionKind(order.expr, scope) === "text" ? sql` COLLATE "C"` : sql``;
			const direction = order.direction === "asc" ? sql`ASC` : sql`DESC`;
			return sql`${expression}${collation} ${direction} NULLS LAST`;
		}),
		sql`, `,
	);

const compileInclude = (
	include: Include,
	userId: string,
	language: string | null,
	ancestors: CompileScope,
	path: readonly number[],
): SqlFragment => {
	const scope = buildScope(include, language, `i${path.join("_")}`, ancestors);
	const orderMetadata = include.orderBy.map((order) => ({
		direction: order.direction,
		kind: expressionKind(order.expr, scope),
	}));
	const ordering = orderSql(orderMetadata);
	const queryOrdering = expressionOrderSql(include.orderBy, scope);
	const fieldValues = include.fields.flatMap((field) => [
		compileExpression(field.expr, scope),
		outputKind(field.expr, scope),
	]);
	const nestedValues = (include.include ?? []).map((nested, index) =>
		compileInclude(nested, userId, language, scope, [...path, index]),
	);
	const itemValues = [...fieldValues, ...nestedValues];
	const item = sql`jsonb_build_array(${sql.join(itemValues, sql`, `)})`;
	const orderColumns = include.orderBy.map(
		(order, index) => sql`${compileExpression(order.expr, scope)} AS ${identifier(`o${index}`)}`,
	);
	const columns = [sql`${item} AS "item"`, ...orderColumns];

	return sql`(
		SELECT jsonb_build_object(
			'items', COALESCE(
				jsonb_agg("indexedIncludeRows"."item" ORDER BY ${ordering})
					FILTER (WHERE "indexedIncludeRows"."includeIndex" <= ${include.limit}),
				'[]'::jsonb
			),
			'hasMore', COUNT(*) > ${include.limit}
		)
		FROM (
			SELECT "orderedIncludeRows".*, ROW_NUMBER() OVER (ORDER BY ${ordering}) AS "includeIndex"
			FROM (
				SELECT ${sql.join(columns, sql`, `)}
				${querySetSql(include, userId, scope)}
				ORDER BY ${queryOrdering}
				LIMIT ${include.limit + 1}
			) "orderedIncludeRows"
		) "indexedIncludeRows"
	)`;
};

const compileRowsQuery = (
	query: NamedQuery,
	userId: string,
	language: string | null,
): SqlFragment => {
	const scope = buildScope(query, language, "");
	const requestedOrder = query.output.orderBy;
	const tieBreakers = [
		...(query.joins ?? []).map((join) => ({ alias: join.table.alias, table: join.table.table })),
		{ alias: query.from.alias, table: query.from.table },
	].flatMap(({ alias, table: tableName }) => {
		const table = requireTable(tableName);
		return requestedOrder.some((order) => isPrimaryKeyOrder(order.expr, alias, table))
			? []
			: [
					{
						direction: "asc" as const,
						expr: { field: table.primaryKey, type: "column" as const, tableAlias: alias },
					},
				];
	});
	const orders = [...requestedOrder, ...tieBreakers];
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
	const includeColumns = (query.output.include ?? []).map(
		(include, index) =>
			sql`${compileInclude(include, userId, language, scope, [index])} AS ${identifier(`i${index}`)}`,
	);
	const columns = [...fieldColumns, ...includeColumns, ...orderColumns, sql`true AS "rowPresent"`];
	const pagination = query.output.pagination;
	const offset = (pagination.page - 1) * pagination.limit;
	const ordering = orderSql(orderMetadata);
	const queryOrdering = expressionOrderSql(orders, scope);

	return sql`
		WITH "queryTotal" AS (
			SELECT COUNT(*)::integer AS "totalCount"
			${querySetSql(query, userId, scope)}
		), "queryRows" AS (
			SELECT ${sql.join(columns, sql`, `)}
			${querySetSql(query, userId, scope)}
			ORDER BY ${queryOrdering}
			LIMIT ${pagination.limit} OFFSET ${offset}
		)
		SELECT "queryRows".*, "queryTotal"."totalCount"
		FROM "queryTotal"
		LEFT JOIN "queryRows" ON true
		ORDER BY ${ordering}
	`;
};

const normalizeValue = (value: unknown, kind: FieldValue["kind"]) => {
	if (kind !== "date") {
		return value;
	}
	if (value instanceof Date) {
		return value.toISOString();
	}
	return typeof value === "string" ? new Date(value).toISOString() : value;
};

const isFieldKind = (value: unknown): value is FieldValue["kind"] =>
	value === "boolean" ||
	value === "date" ||
	value === "json" ||
	value === "null" ||
	value === "number" ||
	value === "text";

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const reconstructInclude = (raw: unknown, include: Include): IncludeResult => {
	if (!isRecord(raw) || !Array.isArray(raw["items"]) || typeof raw["hasMore"] !== "boolean") {
		throw new Error(`RyotQL received an invalid include value for '${include.key}'`);
	}
	const items = raw["items"].map((item): RowItem => {
		if (!Array.isArray(item)) {
			throw new Error(`RyotQL received an invalid include row for '${include.key}'`);
		}
		const fields = include.fields.map((field, index) => {
			const kind = item[index * 2 + 1];
			if (!isFieldKind(kind)) {
				throw new Error(`RyotQL received an invalid field kind for '${field.key}'`);
			}
			return [field.key, { kind, value: normalizeValue(item[index * 2], kind) }] as const;
		});
		const nestedOffset = include.fields.length * 2;
		const nested = (include.include ?? []).map(
			(child, index) => [child.key, reconstructInclude(item[nestedOffset + index], child)] as const,
		);
		return Object.fromEntries([...fields, ...nested]);
	});
	return { items, pageInfo: { limit: include.limit, hasMore: raw["hasMore"] } };
};

export const executeNamedQuery = Effect.fn("executeRyotQLNamedQuery")(function* (
	userId: string,
	language: string | null,
	query: NamedQuery,
) {
	const db = yield* CurrentDb;
	const raw = yield* dbEffect(() => db.execute(compileRowsQuery(query, userId, language)));
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
		const include = (query.output.include ?? []).map(
			(entry, index) => [entry.key, reconstructInclude(row[`i${index}`], entry)] as const,
		);
		return [Object.fromEntries([...fields, ...include])];
	});
	const { page, limit } = query.output.pagination;
	return {
		items,
		type: "rows",
		pageInfo: { page, limit, total, hasMore: (page - 1) * limit + items.length < total },
	} satisfies RowsResult;
});
