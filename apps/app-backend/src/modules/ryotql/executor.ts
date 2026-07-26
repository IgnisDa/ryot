import type {
	AggregateMeasure,
	AggregateOutput,
	AggregateResult,
	AggregationSpec,
	CorrelatedQuerySet,
	FieldSelection,
	FieldValue,
	Include,
	IncludeResult,
	NamedQuery,
	Predicate,
	RowItem,
	RowsResult,
	RowsOutput,
	ScalarExpression,
	TimeSeriesOutput,
	TimeSeriesResult,
} from "@ryot/contract/modules/ryotql/language";
import { sql } from "drizzle-orm";
import { DateTime, Effect, Option } from "effect";

import { CurrentDb, dbEffect } from "#lib/infrastructure/db/service";

import {
	getCatalogTable,
	resolveCatalogField,
	type CatalogFieldKind,
	type CatalogTable,
	type RyotQLExecutionScope,
} from "./catalog";

type SqlFragment = ReturnType<typeof sql>;
type CompileScope = ReadonlyMap<string, CompileTable>;
type RowsQuery = NamedQuery & { readonly output: RowsOutput };
type AggregateQuery = NamedQuery & { readonly output: AggregateOutput };
type TimeSeriesQuery = NamedQuery & { readonly output: TimeSeriesOutput };
type QuerySet = Pick<NamedQuery, "from" | "joins" | "where"> | CorrelatedQuerySet | Include;
type CompileTable = {
	readonly alias: string;
	readonly table: CatalogTable;
	readonly executionScope: RyotQLExecutionScope;
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

const scopeExecution = (scope: CompileScope) => {
	const executionScope = scope.values().next().value?.executionScope;
	if (!executionScope) {
		throw new Error("RyotQL compiler received an empty scope");
	}
	return executionScope;
};

const scopeLanguage = (scope: CompileScope) => {
	const executionScope = scopeExecution(scope);
	return executionScope.type === "user" ? executionScope.language : null;
};

const expressionScope = (query: CorrelatedQuerySet, ancestors: CompileScope) => {
	const executionScope = scopeExecution(ancestors);
	const scope = new Map(ancestors);
	for (const [index, reference] of [
		query.from,
		...(query.joins ?? []).map((join) => join.table),
	].entries()) {
		scope.set(reference.alias, {
			alias: `kind${ancestors.size}_t${index}`,
			table: requireTable(reference.table),
			executionScope,
		});
	}
	return scope;
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
	if (expr.type === "exists") {
		return "boolean";
	}
	if (expr.type === "arithmetic" || expr.type === "aggregate") {
		return "number";
	}
	if (expr.type === "first") {
		return expressionKind(expr.select, expressionScope(expr.query, scope));
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
	if (expr.value === null) {
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
	if (expr.expr.type === "first" && sourceKind === "json") {
		const first = expr.expr;
		return compileFirst(first, scope, (childScope) =>
			compileCast({ expr: first.select, target: expr.target, type: "cast" }, childScope),
		);
	}
	if (expr.expr.type === "coalesce" && sourceKind === "json") {
		const branches = expr.expr.values.map(
			(value) =>
				sql`WHEN ${compileJsonValue(value, scope)} IS NOT NULL THEN ${compileCast(
					{ expr: value, target: expr.target, type: "cast" },
					scope,
				)}`,
		);
		return sql`CASE ${sql.join(branches, sql` `)} ELSE ${typedNull(expr.target)} END`;
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

const compileArithmetic = (
	expr: Extract<ScalarExpression, { type: "arithmetic" }>,
	scope: CompileScope,
) => {
	const left = compileCast({ expr: expr.left, target: "number", type: "cast" }, scope);
	const right = compileCast({ expr: expr.right, target: "number", type: "cast" }, scope);
	if (expr.operator === "divide") {
		return sql`((${left}) / NULLIF((${right}), 0))`;
	}
	let operator = sql`-`;
	if (expr.operator === "add") {
		operator = sql`+`;
	} else if (expr.operator === "multiply") {
		operator = sql`*`;
	}
	return sql`((${left}) ${operator} (${right}))`;
};

const compileExpression = (expr: ScalarExpression, scope: CompileScope): SqlFragment => {
	if (expr.type === "literal") {
		return compileLiteral(expr);
	}
	if (expr.type === "cast") {
		return compileCast(expr, scope);
	}
	if (expr.type === "exists") {
		return compileExists(expr, scope);
	}
	if (expr.type === "arithmetic") {
		return compileArithmetic(expr, scope);
	}
	if (expr.type === "aggregate") {
		return compileAggregate(expr, scope);
	}
	if (expr.type === "first") {
		return compileFirst(expr, scope, (childScope) => compileExpression(expr.select, childScope));
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
	return field.resolve({ language: scopeLanguage(scope), sqlAlias: compileTable.alias });
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
	if (predicate.type === "exists") {
		return compileExists(predicate, scope);
	}
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

const authorizedTable = (table: CatalogTable, scope: RyotQLExecutionScope): SqlFragment => {
	if (scope.type === "user") {
		const policy = table.visibility.user;
		if (policy.type === "public") {
			return sql`(SELECT * FROM ${sql.raw(table.name)})`;
		}
		const column = sql.raw(policy.column);
		return policy.includeGlobal
			? sql`(SELECT * FROM ${sql.raw(table.name)} WHERE (${column} = ${scope.userId} OR ${column} IS NULL))`
			: sql`(SELECT * FROM ${sql.raw(table.name)} WHERE ${column} = ${scope.userId})`;
	}
	const policy = "plugin" in table.visibility ? table.visibility.plugin : undefined;
	if (!policy) {
		throw new Error(`RyotQL compiler received plugin-denied table '${table.name}'`);
	}
	if (policy.type === "eventDefinition") {
		if (scope.eventSchemas.length === 0) {
			return sql`(SELECT * FROM ${sql.raw(table.name)} WHERE false)`;
		}
		const ownership = scope.eventSchemas.map(
			(eventSchema) =>
				sql`(event.event_schema_slug = ${eventSchema.eventSchemaSlug}::text AND event_scope_entity.entity_schema_slug = ${eventSchema.entitySchemaSlug}::text)`,
		);
		return sql`(
			SELECT * FROM event
			WHERE EXISTS (
				SELECT 1 FROM entity event_scope_entity
				WHERE event_scope_entity.id = event.entity_id
				AND (${sql.join(ownership, sql` OR `)})
			)
		)`;
	}
	const ownedSlugs = scope[policy.ownership];
	if (ownedSlugs.length === 0) {
		return sql`(SELECT * FROM ${sql.raw(table.name)} WHERE false)`;
	}
	const discriminator = sql.raw(policy.column);
	const ownership = sql`${discriminator} IN (${sql.join(
		ownedSlugs.map((slug) => sql`${slug}::text`),
		sql`, `,
	)})`;
	return policy.globalOnly
		? sql`(SELECT * FROM ${sql.raw(table.name)} WHERE user_id IS NULL AND ${ownership})`
		: sql`(SELECT * FROM ${sql.raw(table.name)} WHERE ${ownership})`;
};

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
	if (expr.type === "first") {
		return sql`COALESCE(${compileFirst(expr, scope, (childScope) => outputKind(expr.select, childScope))}, 'null')`;
	}
	const kind = expressionKind(expr, scope);
	if (kind === "null") {
		return sql`'null'`;
	}
	return sql`CASE WHEN ${compileExpression(expr, scope)} IS NULL THEN 'null' ELSE ${sql.raw(`'${kind}'`)} END`;
};

const buildScope = (
	query: QuerySet,
	executionScope: RyotQLExecutionScope,
	prefix: string,
	ancestors: CompileScope = new Map(),
) => {
	const root = requireTable(query.from.table);
	const scope = new Map(ancestors);
	scope.set(query.from.alias, { executionScope, alias: `${prefix}t0`, table: root });
	(query.joins ?? []).forEach((join, index) => {
		scope.set(join.table.alias, {
			executionScope,
			alias: `${prefix}t${index + 1}`,
			table: requireTable(join.table.table),
		});
	});
	return scope;
};

const querySetSql = (
	query: QuerySet,
	executionScope: RyotQLExecutionScope,
	scope: CompileScope,
	additionalConditions: readonly SqlFragment[] = [],
): SqlFragment => {
	const root = requireCompileTable(scope, query.from.alias);
	const joins = (query.joins ?? []).map((join) => {
		const joined = requireCompileTable(scope, join.table.alias);
		const joinType = join.type === "inner" ? sql`INNER JOIN` : sql`LEFT JOIN`;
		return sql`${joinType} ${authorizedTable(joined.table, executionScope)} ${sql.raw(joined.alias)} ON ${compilePredicate(join.on, scope)}`;
	});
	const conditions = [
		...(query.where ? [compilePredicate(query.where, scope)] : []),
		...additionalConditions,
	];
	return sql`
		FROM ${authorizedTable(root.table, executionScope)} ${sql.raw(root.alias)}
		${sql.join(joins, sql` `)}
		${conditions.length > 0 ? sql`WHERE ${sql.join(conditions, sql` AND `)}` : sql``}
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

const appendPrimaryKeyOrders = (
	query: QuerySet,
	requested: readonly { readonly expr: ScalarExpression; readonly direction: "asc" | "desc" }[],
) => [
	...requested,
	...[...(query.joins ?? []).map((join) => join.table), query.from].flatMap((reference) => {
		const table = requireTable(reference.table);
		return requested.some((order) => isPrimaryKeyOrder(order.expr, reference.alias, table))
			? []
			: [
					{
						direction: "asc" as const,
						expr: { field: table.primaryKey, type: "column" as const, tableAlias: reference.alias },
					},
				];
	}),
];

const correlatedScope = (query: CorrelatedQuerySet, ancestors: CompileScope) =>
	buildScope(query, scopeExecution(ancestors), `c${ancestors.size}_`, ancestors);

const compileExists = (
	expr: Extract<ScalarExpression, { type: "exists" }>,
	ancestors: CompileScope,
) => {
	const scope = correlatedScope(expr.query, ancestors);
	return sql`EXISTS (SELECT 1 ${querySetSql(expr.query, scopeExecution(ancestors), scope)})`;
};

const compileFirst = (
	expr: Extract<ScalarExpression, { type: "first" }>,
	ancestors: CompileScope,
	select: (scope: CompileScope) => SqlFragment,
) => {
	const scope = correlatedScope(expr.query, ancestors);
	const orders = appendPrimaryKeyOrders(expr.query, expr.orderBy);
	return sql`(SELECT ${select(scope)} ${querySetSql(expr.query, scopeExecution(ancestors), scope)} ORDER BY ${expressionOrderSql(orders, scope)} LIMIT 1)`;
};

const compileAggregate = (
	expr: Extract<ScalarExpression, { type: "aggregate" }>,
	ancestors: CompileScope,
) => {
	const scope = correlatedScope(expr.query, ancestors);
	const value = compileAggregation(expr.aggregation, scope);
	return sql`(SELECT ${value} ${querySetSql(expr.query, scopeExecution(ancestors), scope)})`;
};

const compileAggregation = (aggregation: AggregationSpec, scope: CompileScope) => {
	let value: SqlFragment;
	if (aggregation.function === "count") {
		value = sql`COUNT(*)::double precision`;
	} else if (aggregation.function === "countDistinct") {
		value = sql`COUNT(DISTINCT ${compileExpression(aggregation.expr, scope)})::double precision`;
	} else {
		const operand = compileCast({ expr: aggregation.expr, target: "number", type: "cast" }, scope);
		if (aggregation.function === "sum") {
			value = sql`SUM(${operand})`;
		} else if (aggregation.function === "average") {
			value = sql`AVG(${operand})`;
		} else if (aggregation.function === "minimum") {
			value = sql`MIN(${operand})`;
		} else {
			value = sql`MAX(${operand})`;
		}
	}
	return value;
};

const compileInclude = (
	include: Include,
	executionScope: RyotQLExecutionScope,
	ancestors: CompileScope,
	path: readonly number[],
): SqlFragment => {
	const scope = buildScope(include, executionScope, `i${path.join("_")}`, ancestors);
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
		compileInclude(nested, executionScope, scope, [...path, index]),
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
				${querySetSql(include, executionScope, scope)}
				ORDER BY ${queryOrdering}
				LIMIT ${include.limit + 1}
			) "orderedIncludeRows"
		) "indexedIncludeRows"
	)`;
};

const compileRowsQuery = (query: RowsQuery, executionScope: RyotQLExecutionScope): SqlFragment => {
	const scope = buildScope(query, executionScope, "");
	const orders = appendPrimaryKeyOrders(query, query.output.orderBy);
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
			sql`${compileInclude(include, executionScope, scope, [index])} AS ${identifier(`i${index}`)}`,
	);
	const columns = [...fieldColumns, ...includeColumns, ...orderColumns, sql`true AS "rowPresent"`];
	const pagination = query.output.pagination;
	const offset = (pagination.page - 1) * pagination.limit;
	const ordering = orderSql(orderMetadata);
	const queryOrdering = expressionOrderSql(orders, scope);

	return sql`
		WITH "queryTotal" AS (
			SELECT COUNT(*)::integer AS "totalCount"
			${querySetSql(query, executionScope, scope)}
		), "queryRows" AS (
			SELECT ${sql.join(columns, sql`, `)}
			${querySetSql(query, executionScope, scope)}
			ORDER BY ${queryOrdering}
			LIMIT ${pagination.limit} OFFSET ${offset}
		)
		SELECT "queryRows".*, "queryTotal"."totalCount"
		FROM "queryTotal"
		LEFT JOIN "queryRows" ON true
		ORDER BY ${ordering}
	`;
};

const compileAggregateQuery = (query: AggregateQuery, executionScope: RyotQLExecutionScope) => {
	const scope = buildScope(query, executionScope, "");
	const groups = query.output.groupBy ?? [];
	const groupColumns = groups.flatMap((group, index) => [
		sql`${compileExpression(group.expr, scope)} AS ${identifier(`g${index}v`)}`,
		sql`${outputKind(group.expr, scope)} AS ${identifier(`g${index}k`)}`,
	]);
	const measureColumns = query.output.measures.map(
		(measure, index) =>
			sql`${compileAggregation(measure.aggregation, scope)} AS ${identifier(`m${index}`)}`,
	);
	if (groups.length === 0) {
		return sql`SELECT ${sql.join(measureColumns, sql`, `)} ${querySetSql(query, executionScope, scope)}`;
	}
	if (query.output.limit === undefined || query.output.orderBy === undefined) {
		throw new Error("RyotQL grouped aggregate is missing limit or orderBy after validation");
	}
	const groupOrdinals = groups.flatMap((_, index) => [index * 2 + 1, index * 2 + 2]);
	const measureIndexes = new Map(
		query.output.measures.map((measure, index) => [measure.key, index]),
	);
	const ordering = query.output.orderBy.map((order) => {
		const index = measureIndexes.get(order.key);
		if (index === undefined) {
			throw new Error(`RyotQL compiler received unknown aggregate measure '${order.key}'`);
		}
		const direction = order.direction === "asc" ? sql`ASC` : sql`DESC`;
		return sql`${identifier(`m${index}`)} ${direction} NULLS LAST`;
	});
	return sql`
		SELECT
			${sql.join([...groupColumns, ...measureColumns], sql`, `)},
			COUNT(*) OVER()::integer AS "totalGroups"
		${querySetSql(query, executionScope, scope)}
		GROUP BY ${sql.join(
			groupOrdinals.map((ordinal) => sql.raw(String(ordinal))),
			sql`, `,
		)}
		ORDER BY ${sql.join(ordering, sql`, `)}
		LIMIT ${query.output.limit}
	`;
};

const TIME_SERIES_BUCKET_STEPS: Record<TimeSeriesOutput["time"]["bucket"], string> = {
	day: "1 day",
	hour: "1 hour",
	week: "7 days",
	month: "1 month",
};

const timeSeriesBucketStart = (bucket: TimeSeriesOutput["time"]["bucket"], value: SqlFragment) =>
	sql`date_trunc(${bucket}, ${value} AT TIME ZONE 'UTC')`;

const canonicalTimeSeriesBoundary = (value: string) => {
	const parsed = DateTime.make(value);
	if (Option.isNone(parsed)) {
		throw new Error("RyotQL compiler received an invalid time-series boundary after validation");
	}
	return DateTime.formatIso(parsed.value);
};

const compileTimeSeriesQuery = (query: TimeSeriesQuery, executionScope: RyotQLExecutionScope) => {
	const scope = buildScope(query, executionScope, "");
	const time = compileExpression(query.output.time.expr, scope);
	const measure = compileAggregation(query.output.measure.aggregation, scope);
	const endAt = canonicalTimeSeriesBoundary(query.output.time.range.endAt);
	const startAt = canonicalTimeSeriesBoundary(query.output.time.range.startAt);
	const { bucket } = query.output.time;
	const step = sql.raw(`interval '${TIME_SERIES_BUCKET_STEPS[bucket]}'`);
	const gridStart = timeSeriesBucketStart(bucket, sql`${startAt}::timestamptz`);
	const gridStop = timeSeriesBucketStart(
		bucket,
		sql`(${endAt}::timestamptz - interval '1 microsecond')`,
	);
	const range = sql`(${time} >= ${startAt}::timestamptz AND ${time} < ${endAt}::timestamptz)`;
	return sql`
		WITH "timeSeriesAggregate" AS (
			SELECT ${timeSeriesBucketStart(bucket, time)} AS "bucketStart", ${measure} AS "value"
			${querySetSql(query, executionScope, scope, [range])}
			GROUP BY 1
		)
		SELECT
			("timeSeriesGrid"."bucketStart" AT TIME ZONE 'UTC') AS "startAt",
			(("timeSeriesGrid"."bucketStart" + ${step}) AT TIME ZONE 'UTC') AS "endAt",
			COALESCE("timeSeriesAggregate"."value", 0) AS "value"
		FROM generate_series(${gridStart}, ${gridStop}, ${step}) AS "timeSeriesGrid"("bucketStart")
		LEFT JOIN "timeSeriesAggregate" ON "timeSeriesAggregate"."bucketStart" = "timeSeriesGrid"."bucketStart"
		ORDER BY "timeSeriesGrid"."bucketStart"
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

const reconstructAggregateItem = (
	row: Readonly<Record<string, unknown>>,
	groups: readonly FieldSelection[],
	measures: readonly AggregateMeasure[],
) => {
	const grouped = groups.map((group, index) => {
		const kind = row[`g${index}k`];
		if (!isFieldKind(kind)) {
			throw new Error(`RyotQL received an invalid field kind for '${group.key}'`);
		}
		return [group.key, { kind, value: normalizeValue(row[`g${index}v`], kind) }] as const;
	});
	const measured = measures.map((measure, index) => {
		const value = row[`m${index}`];
		return [
			measure.key,
			value === null
				? ({ kind: "null", value: null } as const)
				: ({ kind: "number", value: Number(value) } as const),
		] as const;
	});
	return Object.fromEntries([...grouped, ...measured]);
};

const executeAggregateQuery = Effect.fn("executeRyotQLAggregateQuery")(function* (
	executionScope: RyotQLExecutionScope,
	query: AggregateQuery,
) {
	const db = yield* CurrentDb;
	const raw = yield* dbEffect(() => db.execute(compileAggregateQuery(query, executionScope)));
	const rows = raw.rows as readonly Record<string, unknown>[];
	const groups = query.output.groupBy ?? [];
	const items = rows.map((row) => reconstructAggregateItem(row, groups, query.output.measures));
	if (groups.length === 0) {
		return { items, type: "aggregate" } satisfies AggregateResult;
	}
	const limit = query.output.limit;
	if (limit === undefined) {
		throw new Error("RyotQL grouped aggregate is missing a limit after validation");
	}
	const totalGroups = rows[0] ? Number(rows[0]["totalGroups"]) : 0;
	return {
		items,
		type: "aggregate",
		pageInfo: { limit, hasMore: totalGroups > limit },
	} satisfies AggregateResult;
});

const executeTimeSeriesQuery = Effect.fn("executeRyotQLTimeSeriesQuery")(function* (
	executionScope: RyotQLExecutionScope,
	query: TimeSeriesQuery,
) {
	const db = yield* CurrentDb;
	const raw = yield* dbEffect(() => db.execute(compileTimeSeriesQuery(query, executionScope)));
	const buckets = (raw.rows as readonly Record<string, unknown>[]).map((row) => {
		const startAt = normalizeValue(row["startAt"], "date");
		const endAt = normalizeValue(row["endAt"], "date");
		if (typeof startAt !== "string" || typeof endAt !== "string") {
			throw new Error("RyotQL received an invalid time-series bucket boundary");
		}
		return { startAt, endAt, value: Number(row["value"]) };
	});
	return { buckets, type: "timeSeries" } satisfies TimeSeriesResult;
});

export const executeNamedQuery = Effect.fn("executeRyotQLNamedQuery")(function* (
	executionScope: RyotQLExecutionScope,
	query: NamedQuery,
) {
	if (query.output.type === "aggregate") {
		return yield* executeAggregateQuery(executionScope, { ...query, output: query.output });
	}
	if (query.output.type === "timeSeries") {
		return yield* executeTimeSeriesQuery(executionScope, { ...query, output: query.output });
	}
	const db = yield* CurrentDb;
	const rowsQuery = { ...query, output: query.output };
	const raw = yield* dbEffect(() => db.execute(compileRowsQuery(rowsQuery, executionScope)));
	const rows = raw.rows as readonly Record<string, unknown>[];
	const first = rows[0];
	const total = first ? Number(first["totalCount"]) : 0;
	const items = rows.flatMap((row) => {
		if (row["rowPresent"] !== true) {
			return [];
		}
		const fields = rowsQuery.output.fields.map((field, index) => {
			const kind = row[`f${index}k`];
			if (!isFieldKind(kind)) {
				throw new Error(`RyotQL received an invalid field kind for '${field.key}'`);
			}
			return [field.key, { kind, value: normalizeValue(row[`f${index}v`], kind) }] as const;
		});
		const include = (rowsQuery.output.include ?? []).map(
			(entry, index) => [entry.key, reconstructInclude(row[`i${index}`], entry)] as const,
		);
		return [Object.fromEntries([...fields, ...include])];
	});
	const { page, limit } = rowsQuery.output.pagination;
	return {
		items,
		type: "rows",
		pageInfo: { page, limit, total, hasMore: (page - 1) * limit + items.length < total },
	} satisfies RowsResult;
});
