import { BadRequest } from "@ryot/contract/errors";
import type {
	AggregateMeasure,
	AggregateOutput,
	AggregateResult,
	AggregationSpec,
	CorrelatedQuerySet,
	FieldSelection,
	Include,
	IncludeResult,
	NamedQuery,
	Predicate,
	RowItem,
	RowsResult,
	ScalarExpression,
	TimeSeriesOutput,
	TimeSeriesResult,
} from "@ryot/contract/modules/ryotql/language";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { DateTime, Effect, Option, Schema } from "effect";

import { Database, mapDatabaseErrors } from "#lib/infrastructure/db/service";

import {
	getCatalogTable,
	resolveCatalogField,
	type CatalogFieldKind,
	type CatalogTable,
	type RyotQLExecutionScope,
} from "./catalog";
import type { NormalizedInclude, NormalizedNamedQuery, NormalizedRowsOutput } from "./normalizer";

type SqlFragment = ReturnType<typeof sql>;
type CompileScope = ReadonlyMap<string, CompileTable>;
type RowsQuery = Omit<NormalizedNamedQuery, "output"> & { readonly output: NormalizedRowsOutput };
type AggregateQuery = NamedQuery & { readonly output: AggregateOutput };
type TimeSeriesQuery = NamedQuery & { readonly output: TimeSeriesOutput };
type QuerySet = Pick<NamedQuery, "from" | "joins" | "where"> | CorrelatedQuerySet | Include;
type CompileTable = {
	readonly alias: string;
	readonly table: CatalogTable;
	readonly joinedNullable: boolean;
	readonly executionScope: RyotQLExecutionScope;
};
type Order = {
	readonly expr: ScalarExpression;
	readonly direction: "asc" | "desc";
};
type RuntimeKind = CatalogFieldKind | "null";
type CursorValue =
	| { readonly kind: "null"; readonly value: null }
	| { readonly kind: "boolean"; readonly value: boolean }
	| { readonly kind: "date"; readonly value: string }
	| { readonly kind: "json"; readonly value: unknown }
	| { readonly kind: "number"; readonly value: number }
	| { readonly kind: "text"; readonly value: string };

const CURSOR_VERSION = 1;

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
			joinedNullable: index > 0,
			executionScope,
		});
	}
	return scope;
};

const unifyExpressionKinds = (kinds: readonly (CatalogFieldKind | "null")[]) => {
	const nonNullKinds = kinds.filter((kind) => kind !== "null");
	if (nonNullKinds.length === 0) {
		return "null" as const;
	}
	const first = nonNullKinds[0];
	return first !== undefined && nonNullKinds.every((kind) => kind === first) ? first : "json";
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
	if (expr.type === "concat" || expr.type === "transform") {
		return "text";
	}
	if (expr.type === "isNotNull") {
		return "boolean";
	}
	if (expr.type === "floor" || expr.type === "integer" || expr.type === "round") {
		return "number";
	}
	if (expr.type === "first") {
		return expressionKind(expr.select, expressionScope(expr.query, scope));
	}
	if (expr.type === "jsonPath") {
		return "json";
	}
	if (expr.type === "coalesce") {
		return unifyExpressionKinds(expr.values.map((value) => expressionKind(value, scope)));
	}
	if (expr.type === "conditional") {
		return unifyExpressionKinds([
			expressionKind(expr.whenTrue, scope),
			expressionKind(expr.whenFalse, scope),
		]);
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

const compileTextValue = (expr: ScalarExpression, scope: CompileScope): SqlFragment => {
	const kind = expressionKind(expr, scope);
	if (kind === "null") {
		return sql`NULL::text`;
	}
	if (kind === "json") {
		return sql`NULLIF((${compileJsonValue(expr, scope)} #>> '{}'), 'null')`;
	}
	if (kind === "text") {
		return compileExpression(expr, scope);
	}
	return sql`(${compileExpression(expr, scope)})::text`;
};

const compileTextTransform = (
	expr: Extract<ScalarExpression, { type: "transform" }>,
	scope: CompileScope,
) => {
	const value = compileTextValue(expr.expr, scope);
	const camelCase = sql`regexp_replace(${value}, ${String.raw`([a-z0-9])([A-Z])`}, ${String.raw`\1 \2`}, 'g')`;
	if (expr.name === "titleCase") {
		return sql`initcap(regexp_replace(${camelCase}, ${"[^A-Za-z0-9]+"}, ${" "}, 'g'))`;
	}
	const separated = sql`regexp_replace(${camelCase}, ${"[^A-Za-z0-9]+"}, ${"-"}, 'g')`;
	return sql`btrim(lower(${separated}), '-')`;
};

const compileConditional = (
	expr: Extract<ScalarExpression, { type: "conditional" }>,
	scope: CompileScope,
) => {
	const kind = expressionKind(expr, scope);
	const compileBranch = (branch: ScalarExpression) =>
		kind === "json" ? compileJsonValue(branch, scope) : compileExpression(branch, scope);
	return sql`CASE WHEN ${compilePredicate(expr.condition, scope)} THEN ${compileBranch(expr.whenTrue)} ELSE ${compileBranch(expr.whenFalse)} END`;
};

const compileUnary = (
	expr: Extract<ScalarExpression, { type: "floor" | "integer" | "round" }>,
	scope: CompileScope,
) => {
	const value = compileCast({ expr: expr.expr, target: "number", type: "cast" }, scope);
	if (expr.type === "round") {
		return sql`round(${value})`;
	}
	if (expr.type === "floor") {
		return sql`floor(${value})`;
	}
	return sql`trunc(${value})`;
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
	if (expr.type === "concat") {
		return sql`concat(${sql.join(
			expr.values.map((value) => compileTextValue(value, scope)),
			sql`, `,
		)})`;
	}
	if (expr.type === "conditional") {
		return compileConditional(expr, scope);
	}
	if (expr.type === "transform") {
		return compileTextTransform(expr, scope);
	}
	if (expr.type === "isNotNull") {
		return sql`(${compileExpression(expr.expr, scope)} IS NOT NULL)`;
	}
	if (expr.type === "floor" || expr.type === "integer" || expr.type === "round") {
		return compileUnary(expr, scope);
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

const expressionNullable = (expr: ScalarExpression, scope: CompileScope): boolean => {
	if (expr.type === "literal") {
		return expr.value === null;
	}
	if (expr.type === "exists" || expr.type === "isNotNull") {
		return false;
	}
	if (expr.type === "column") {
		const table = requireCompileTable(scope, expr.tableAlias);
		const field = resolveCatalogField(table.table, expr.field);
		return (
			table.joinedNullable || (expr.field !== table.table.primaryKey && (field?.nullable ?? true))
		);
	}
	return true;
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
		const comparison = sql`${compileExpression(predicate.left, scope)} ${operator} ${compileExpression(predicate.right, scope)}`;
		return expressionNullable(predicate.left, scope) || expressionNullable(predicate.right, scope)
			? sql`COALESCE(${comparison}, false)`
			: comparison;
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
	const comparison = sql`${compileExpression(predicate.expr, scope)} IN (${sql.join(
		predicate.values.map((value) => compileExpression(value, scope)),
		sql`, `,
	)})`;
	return expressionNullable(predicate.expr, scope) ||
		predicate.values.some((value) => expressionNullable(value, scope))
		? sql`COALESCE(${comparison}, false)`
		: comparison;
};

const authorizedTable = (table: CatalogTable, scope: RyotQLExecutionScope): SqlFragment => {
	if (scope.type === "user") {
		const policy = table.visibility.user;
		if (policy.type === "public") {
			return sql`(SELECT * FROM ${sql.raw(table.name)})`;
		}
		if (policy.type === "parentOwned") {
			const column = sql.raw(`${table.name}.${policy.column}`);
			const parentTable = sql.raw(policy.parentTable);
			const parentColumn = sql.raw(`${policy.parentTable}.${policy.parentColumn}`);
			const parentOwnerColumn = sql.raw(`${policy.parentTable}.${policy.parentOwnerColumn}`);
			return sql`(SELECT * FROM ${sql.raw(table.name)} WHERE EXISTS (SELECT 1 FROM ${parentTable} WHERE ${parentColumn} = ${column} AND ${parentOwnerColumn} = ${scope.userId}))`;
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
	if (expr.type === "conditional" && expressionKind(expr, scope) === "json") {
		const value = compileJsonValue(expr, scope);
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

const hasRuntimeOutputKind = (expr: ScalarExpression, scope: CompileScope): boolean => {
	if (expr.type === "jsonPath") {
		return true;
	}
	if (expr.type === "first") {
		return hasRuntimeOutputKind(expr.select, expressionScope(expr.query, scope));
	}
	return (
		(expr.type === "conditional" || expr.type === "coalesce") &&
		expressionKind(expr, scope) === "json"
	);
};

const compileOutputColumns = (
	expr: ScalarExpression,
	scope: CompileScope,
	valueAlias: string,
	kindAlias: string,
) => {
	const value = sql`${compileExpression(expr, scope)} AS ${identifier(valueAlias)}`;
	return hasRuntimeOutputKind(expr, scope)
		? [value, sql`${outputKind(expr, scope)} AS ${identifier(kindAlias)}`]
		: [value];
};

const buildScope = (
	query: QuerySet,
	executionScope: RyotQLExecutionScope,
	prefix: string,
	ancestors: CompileScope = new Map(),
) => {
	const root = requireTable(query.from.table);
	const scope = new Map(ancestors);
	scope.set(query.from.alias, {
		executionScope,
		alias: `${prefix}t0`,
		table: root,
		joinedNullable: false,
	});
	(query.joins ?? []).forEach((join, index) => {
		scope.set(join.table.alias, {
			executionScope,
			alias: `${prefix}t${index + 1}`,
			table: requireTable(join.table.table),
			joinedNullable: join.type === "left",
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

const appendPrimaryKeyOrders = (query: QuerySet, requested: readonly Order[]) => [
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

const cursorError = () => new BadRequest({ message: "Invalid RyotQL cursor" });

const makeCursorValue = (
	kind: CatalogFieldKind | "null",
	value: unknown,
): CursorValue | undefined => {
	if (kind === "null") {
		return value === null ? { kind, value } : undefined;
	}
	if (kind === "boolean") {
		return typeof value === "boolean" ? { kind, value } : undefined;
	}
	if (kind === "date") {
		return typeof value === "string" && Option.isSome(DateTime.make(value))
			? { kind, value }
			: undefined;
	}
	if (kind === "number") {
		return typeof value === "number" && Number.isFinite(value) ? { kind, value } : undefined;
	}
	if (kind === "text") {
		return typeof value === "string" ? { kind, value } : undefined;
	}
	return { kind, value };
};

const decodeCursor = Effect.fn("decodeRyotQLCursor")(function* (
	cursor: string,
	kinds: readonly (CatalogFieldKind | "null")[],
	directions: readonly Order["direction"][],
) {
	if (!/^[A-Za-z0-9_-]+$/.test(cursor)) {
		return yield* cursorError();
	}
	const bytes = Buffer.from(cursor, "base64url");
	if (bytes.toString("base64url") !== cursor) {
		return yield* cursorError();
	}
	const decoded = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown))(
		bytes.toString("utf8"),
	).pipe(Effect.mapError(cursorError));
	if (
		!isRecord(decoded) ||
		decoded["version"] !== CURSOR_VERSION ||
		!Array.isArray(decoded["directions"]) ||
		!Array.isArray(decoded["values"])
	) {
		return yield* cursorError();
	}
	if (
		decoded["directions"].length !== directions.length ||
		decoded["directions"].some((direction, index) => direction !== directions[index]) ||
		decoded["values"].length !== kinds.length
	) {
		return yield* cursorError();
	}
	if (directions.length !== kinds.length) {
		return yield* cursorError();
	}
	const values: CursorValue[] = [];
	for (const [index, raw] of decoded["values"].entries()) {
		const expected = kinds[index];
		if (!isRecord(raw) || typeof raw["kind"] !== "string" || !("value" in raw)) {
			return yield* cursorError();
		}
		if (raw["kind"] === "null") {
			if (raw["value"] !== null) {
				return yield* cursorError();
			}
			values.push({ kind: "null", value: null });
			continue;
		}
		if (raw["kind"] !== expected || expected === "null") {
			return yield* cursorError();
		}
		const value = makeCursorValue(expected, raw["value"]);
		if (!value) {
			return yield* cursorError();
		}
		values.push(value);
	}
	return values;
});

const encodeCursor = (values: readonly CursorValue[], directions: readonly Order["direction"][]) =>
	Buffer.from(
		Schema.encodeSync(Schema.fromJsonString(Schema.Unknown))({
			values,
			directions,
			version: CURSOR_VERSION,
		}),
	).toString("base64url");

const cursorSqlValue = (value: Exclude<CursorValue, { kind: "null" }>) => {
	if (value.kind === "date") {
		return sql`${value.value}::timestamptz`;
	}
	if (value.kind === "number") {
		return sql`${value.value}::double precision`;
	}
	if (value.kind === "boolean") {
		return sql`${value.value}::boolean`;
	}
	if (value.kind === "json") {
		return sql`${JSON.stringify(value.value)}::jsonb`;
	}
	return sql`${value.value}::text`;
};

const compileCursorPredicate = (
	orders: readonly Order[],
	values: readonly CursorValue[],
	scope: CompileScope,
) => {
	const terms: SqlFragment[] = [];
	for (const [index, order] of orders.entries()) {
		const current = values[index];
		if (!current || current.kind === "null") {
			continue;
		}
		const prefix = orders.slice(0, index).map((prefixOrder, prefixIndex) => {
			const prefixValue = values[prefixIndex];
			if (!prefixValue) {
				throw new Error("RyotQL compiler received a cursor with missing order values");
			}
			const expression = compileExpression(prefixOrder.expr, scope);
			return prefixValue.kind === "null"
				? sql`${expression} IS NOT DISTINCT FROM NULL`
				: sql`${expression} IS NOT DISTINCT FROM ${cursorSqlValue(prefixValue)}`;
		});
		const expression = compileExpression(order.expr, scope);
		const value = cursorSqlValue(current);
		const orderedExpression = current.kind === "text" ? sql`${expression} COLLATE "C"` : expression;
		const orderedValue = current.kind === "text" ? sql`${value} COLLATE "C"` : value;
		const operator = order.direction === "asc" ? sql`>` : sql`<`;
		const orderedComparison = sql`${orderedExpression} ${operator} ${orderedValue}`;
		const comparison = expressionNullable(order.expr, scope)
			? sql`(${orderedComparison} OR ${expression} IS NULL)`
			: orderedComparison;
		terms.push(
			prefix.length === 0 ? comparison : sql`(${sql.join(prefix, sql` AND `)} AND ${comparison})`,
		);
	}
	return terms.length === 0 ? sql`false` : sql`(${sql.join(terms, sql` OR `)})`;
};

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
	include: NormalizedInclude,
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
	const fieldValues = include.fields.flatMap((field) =>
		hasRuntimeOutputKind(field.expr, scope)
			? [compileExpression(field.expr, scope), outputKind(field.expr, scope)]
			: [compileExpression(field.expr, scope)],
	);
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

const compileRowsQuery = (
	query: RowsQuery,
	executionScope: RyotQLExecutionScope,
	cursor: readonly CursorValue[] | undefined,
): SqlFragment => {
	const scope = buildScope(query, executionScope, "");
	const orders = appendPrimaryKeyOrders(query, query.output.orderBy);
	const fieldColumns = query.output.fields.flatMap((field, index) =>
		compileOutputColumns(field.expr, scope, `f${index}v`, `f${index}k`),
	);
	const orderColumns = orders.map(
		(order, index) => sql`${compileExpression(order.expr, scope)} AS ${identifier(`o${index}`)}`,
	);
	const includeColumns = (query.output.include ?? []).map(
		(include, index) =>
			sql`${compileInclude(include, executionScope, scope, [index])} AS ${identifier(`i${index}`)}`,
	);
	const columns = [...fieldColumns, ...includeColumns, ...orderColumns];
	const pagination = query.output.pagination;
	const queryOrdering = expressionOrderSql(orders, scope);
	const cursorCondition = cursor ? [compileCursorPredicate(orders, cursor, scope)] : [];

	return sql`
		SELECT ${sql.join(columns, sql`, `)}
		${querySetSql(query, executionScope, scope, cursorCondition)}
		ORDER BY ${queryOrdering}
		LIMIT ${pagination.limit + 1}
	`;
};

const compileAggregateQuery = (query: AggregateQuery, executionScope: RyotQLExecutionScope) => {
	const scope = buildScope(query, executionScope, "");
	const groups = query.output.groupBy ?? [];
	const groupColumns = groups.flatMap((group, index) =>
		compileOutputColumns(group.expr, scope, `g${index}v`, `g${index}k`),
	);
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
	let groupOrdinal = 1;
	const groupOrdinals = groups.flatMap((group) => {
		const count = hasRuntimeOutputKind(group.expr, scope) ? 2 : 1;
		return Array.from({ length: count }, () => groupOrdinal++);
	});
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

const pgDialect = new PgDialect();

const executeSql = Effect.fn("executeRyotQLSql")(function* (query: SqlFragment, queryName: string) {
	const db = yield* Database;
	const { sql: statement } = pgDialect.sqlToQuery(query);
	yield* Effect.logTrace("RyotQL SQL generated").pipe(
		Effect.annotateLogs({ queryName, sql: statement }),
	);
	return yield* mapDatabaseErrors(db.execute(query, "objects"));
});

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

const normalizeValue = (value: unknown, kind: RuntimeKind) => {
	if (kind === "number") {
		return Number(value);
	}
	if (kind !== "date") {
		return value;
	}
	if (value instanceof Date) {
		return value.toISOString();
	}
	return typeof value === "string" ? new Date(value).toISOString() : value;
};

const isFieldKind = (value: unknown): value is RuntimeKind =>
	value === "boolean" ||
	value === "date" ||
	value === "json" ||
	value === "null" ||
	value === "number" ||
	value === "text";

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const reconstructKind = (
	expr: ScalarExpression,
	scope: CompileScope,
	value: unknown,
	runtimeKind: unknown,
) => {
	if (value === null) {
		return "null" as const;
	}
	if (hasRuntimeOutputKind(expr, scope)) {
		if (!isFieldKind(runtimeKind)) {
			throw new Error("RyotQL received an invalid runtime field kind");
		}
		return runtimeKind;
	}
	const kind = expressionKind(expr, scope);
	if (kind === "null") {
		throw new Error("RyotQL received a non-null value for a null expression");
	}
	return kind;
};

const reconstructInclude = (
	raw: unknown,
	include: NormalizedInclude,
	executionScope: RyotQLExecutionScope,
	ancestors: CompileScope,
): IncludeResult => {
	if (!isRecord(raw) || !Array.isArray(raw["items"]) || typeof raw["hasMore"] !== "boolean") {
		throw new Error(`RyotQL received an invalid include value for '${include.key}'`);
	}
	const items = raw["items"].map((item): RowItem => {
		if (!Array.isArray(item)) {
			throw new Error(`RyotQL received an invalid include row for '${include.key}'`);
		}
		const scope = buildScope(include, executionScope, "", ancestors);
		let offset = 0;
		const fields = include.fields.map((field) => {
			const value = item[offset++];
			const kind = reconstructKind(field.expr, scope, value, item[offset]);
			if (hasRuntimeOutputKind(field.expr, scope)) {
				offset += 1;
			}
			return [field.key, normalizeValue(value, kind)] as const;
		});
		const nested = (include.include ?? []).map(
			(child, index) =>
				[
					child.key,
					reconstructInclude(item[offset + index], child, executionScope, scope),
				] as const,
		);
		return Object.fromEntries([...fields, ...nested]);
	});
	return { items, pageInfo: { limit: include.limit, hasMore: raw["hasMore"] } };
};

const reconstructAggregateItem = (
	row: Readonly<Record<string, unknown>>,
	groups: readonly FieldSelection[],
	measures: readonly AggregateMeasure[],
	scope: CompileScope,
) => {
	const grouped = groups.map((group, index) => {
		const value = row[`g${index}v`];
		const kind = reconstructKind(group.expr, scope, value, row[`g${index}k`]);
		return [group.key, normalizeValue(value, kind)] as const;
	});
	const measured = measures.map((measure, index) => {
		const value = row[`m${index}`];
		return [measure.key, value === null ? null : Number(value)] as const;
	});
	return Object.fromEntries([...grouped, ...measured]);
};

const executeAggregateQuery = Effect.fn("executeRyotQLAggregateQuery")(function* (
	executionScope: RyotQLExecutionScope,
	query: AggregateQuery,
	queryName: string,
) {
	const raw = yield* executeSql(compileAggregateQuery(query, executionScope), queryName);
	const rows = raw;
	const groups = query.output.groupBy ?? [];
	const scope = buildScope(query, executionScope, "");
	const items = rows.map((row) =>
		reconstructAggregateItem(row, groups, query.output.measures, scope),
	);
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
	queryName: string,
) {
	const raw = yield* executeSql(compileTimeSeriesQuery(query, executionScope), queryName);
	const buckets = raw.map((row) => {
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
	query: NormalizedNamedQuery,
	queryName: string,
) {
	if (query.output.type === "aggregate") {
		return yield* executeAggregateQuery(
			executionScope,
			{ ...query, output: query.output },
			queryName,
		);
	}
	if (query.output.type === "timeSeries") {
		return yield* executeTimeSeriesQuery(
			executionScope,
			{ ...query, output: query.output },
			queryName,
		);
	}
	const rowsQuery = { ...query, output: query.output };
	const scope = buildScope(rowsQuery, executionScope, "");
	const orders = appendPrimaryKeyOrders(rowsQuery, rowsQuery.output.orderBy);
	const orderKinds = orders.map((order) => expressionKind(order.expr, scope));
	const orderDirections = orders.map((order) => order.direction);
	const cursor = rowsQuery.output.pagination.after
		? yield* decodeCursor(rowsQuery.output.pagination.after, orderKinds, orderDirections)
		: undefined;
	const raw = yield* executeSql(compileRowsQuery(rowsQuery, executionScope, cursor), queryName);
	const rows = raw;
	const { limit } = rowsQuery.output.pagination;
	const hasMore = rows.length > limit;
	const returnedRows = rows.slice(0, limit);
	const items = returnedRows.map((row) => {
		const fields = rowsQuery.output.fields.map((field, index) => {
			const value = row[`f${index}v`];
			const kind = reconstructKind(field.expr, scope, value, row[`f${index}k`]);
			return [field.key, normalizeValue(value, kind)] as const;
		});
		const include = (rowsQuery.output.include ?? []).map(
			(entry, index) =>
				[entry.key, reconstructInclude(row[`i${index}`], entry, executionScope, scope)] as const,
		);
		return Object.fromEntries([...fields, ...include]);
	});
	const last = hasMore ? returnedRows.at(-1) : undefined;
	const nextCursor = last
		? encodeCursor(
				orderKinds.map((kind, index): CursorValue => {
					const value = last[`o${index}`];
					if (value === null) {
						return { kind: "null", value: null };
					}
					const cursorValue = makeCursorValue(kind, normalizeValue(value, kind));
					if (!cursorValue) {
						throw new Error("RyotQL received an invalid order value");
					}
					return cursorValue;
				}),
				orderDirections,
			)
		: null;

	return { items, type: "rows", pageInfo: { limit, hasMore, nextCursor } } satisfies RowsResult;
});
