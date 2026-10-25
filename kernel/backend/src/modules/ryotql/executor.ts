import { RyotQLBadRequest } from "@ryot-app/contract/modules/ryotql/contract";
import type {
	AggregateMeasure,
	AggregateOutput,
	AggregateResult,
	AggregationSpec,
	FieldSelection,
	IncludeResult,
	NamedQuery,
	Predicate,
	RowItem,
	RowsResult,
	ScalarExpression,
	TimeSeriesOutput,
	TimeSeriesResult,
} from "@ryot-app/contract/modules/ryotql/language";
import { isJsonValue } from "@ryot-app/contract/schema/json";
import { sha256Hex } from "@ryot-app/ts-utils/crypto";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { isObjectRecord, isUnknownArray } from "@ryot-app/ts-utils/predicates";
import { sql } from "drizzle-orm";
import type { EffectPgDatabase } from "drizzle-orm/effect-postgres";
import { PgDialect } from "drizzle-orm/pg-core";
import { DateTime, Effect, Option, Schema } from "effect";

import { pinnedDefinitionSource } from "#modules/definitions/read-context";
import { mapDatabaseErrors } from "#platform/db/errors";

import { definitionReadContext, pluginIdentityReferences } from "./binding";
import {
	canAccessCatalogTable,
	type CatalogTable,
	jsonElementsTable,
	resolveCatalogField,
	type RyotQLExecutionScope,
} from "./catalog";
import { scalarExpressionKind, type ScalarKind } from "./expression-kind";
import {
	type AliasScope,
	childScope,
	conjuncts,
	correlatedAliasScope,
	jsonKeyColumn,
	kindResolver,
	lookupTable,
	type PlannedScope,
	type PlannedTable,
	planQuery,
	planScopes,
	type QuerySet,
} from "./planner";
import type { ExpandedInclude, ExpandedNamedQuery, ExpandedRowsOutput } from "./validator";

type SqlFragment = ReturnType<typeof sql>;
type AggregateQuery = NamedQuery & { readonly output: AggregateOutput };
type CastTarget = Extract<ScalarExpression, { type: "cast" }>["target"];
type TimeSeriesQuery = NamedQuery & { readonly output: TimeSeriesOutput };
type Order = { readonly expr: ScalarExpression; readonly direction: "asc" | "desc" };
type RowsQuery = Omit<ExpandedNamedQuery, "output"> & { readonly output: ExpandedRowsOutput };
type Context = {
	readonly fused: boolean;
	readonly hoisted: boolean;
	readonly scope: PlannedScope;
	readonly elementDepth: number;
	readonly element: string | undefined;
};
type CursorValue =
	| { readonly value: null; readonly kind: "null" }
	| { readonly kind: "date"; readonly value: string }
	| { readonly kind: "text"; readonly value: string }
	| { readonly kind: "json"; readonly value: unknown }
	| { readonly value: number; readonly kind: "number" }
	| { readonly value: boolean; readonly kind: "boolean" };

const CURSOR_VERSION = 1;
const encodeJson = (value: unknown) =>
	Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(value).pipe(Effect.orDie);

const identifier = (value: string): SqlFragment => sql`${sql.identifier(value)}`;

const qualifiedIdentifier = (table: string, column: string): SqlFragment =>
	sql`${sql.identifier(table)}.${sql.identifier(column)}`;

const rootContext = (scope: PlannedScope): Context => ({
	scope,
	fused: true,
	hoisted: true,
	elementDepth: 0,
	element: undefined,
});

const correlatedContext = (ctx: Context, query: Parameters<typeof childScope>[1]): Context => ({
	...ctx,
	fused: true,
	scope: childScope(ctx.scope, query),
});

const ownerScope = (scope: PlannedScope, alias: string): PlannedScope => {
	let current: undefined | PlannedScope = scope;
	while (current) {
		if (current.tables.has(alias)) {
			return current;
		}
		current = current.parent;
	}
	throw new Error(`RyotQL compiler received unknown alias '${alias}'`);
};

const resolveField = (scope: AliasScope, alias: string, field: string) =>
	resolveCatalogField(lookupTable(scope, alias).table, field, scope.execution);

const expressionKind = (expr: ScalarExpression, scope: AliasScope): ScalarKind => {
	const kind = scalarExpressionKind(expr, scope, kindResolver);
	if (!kind) {
		throw new Error("RyotQL compiler could not infer an expression kind");
	}
	return kind;
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

const castSqlType = (target: CastTarget) => {
	if (target === "number") {
		return "double precision";
	}
	if (target === "date") {
		return "timestamp with time zone";
	}
	return target === "json" ? "jsonb" : target;
};

const typedNull = (target: CastTarget) => sql.raw(`NULL::${castSqlType(target)}`);

const safeInputValid = (value: SqlFragment, target: CastTarget) => {
	const valid = sql`pg_input_is_valid(${value}, ${castSqlType(target)})`;
	if (target === "number") {
		return sql`(${valid} AND lower(btrim(${value})) NOT IN ('nan', 'infinity', '+infinity', '-infinity', 'inf', '+inf', '-inf'))`;
	}
	if (target === "date") {
		return sql`(${valid} AND lower(btrim(${value})) NOT IN ('infinity', '+infinity', '-infinity'))`;
	}
	return valid;
};

const inlineCastOperand = (expr: ScalarExpression, scope: AliasScope): boolean => {
	if (expr.type === "literal" || expr.type === "jsonElement") {
		return true;
	}
	if (expr.type === "jsonPath") {
		return inlineCastOperand(expr.expr, scope);
	}
	return (
		expr.type === "column" && resolveField(scope, expr.tableAlias, expr.field)?.column !== undefined
	);
};

const bindCastOperand = (
	expr: ScalarExpression,
	ctx: Context,
	operand: SqlFragment,
	cast: (value: SqlFragment) => SqlFragment,
) =>
	inlineCastOperand(expr, ctx.scope)
		? cast(operand)
		: // Subquery operands stay bound; scalar columns must remain visible to join planning.
			sql`(SELECT ${cast(sql.raw("cast_operand.value"))} FROM (SELECT ${operand} AS value OFFSET 0) cast_operand)`;

const compileJsonValue = (expr: ScalarExpression, ctx: Context): SqlFragment => {
	const kind = expressionKind(expr, ctx.scope);
	if (kind === "null") {
		return sql`NULL::jsonb`;
	}
	const compiled = compileExpression(expr, ctx);
	return kind === "json" ? sql`NULLIF(${compiled}, 'null'::jsonb)` : sql`to_jsonb(${compiled})`;
};

// Integer-like segments also address array indexes in jsonb_extract_path, so only plain object
// keys use the single-call typed JSON path.
const strictObjectPath = (path: Extract<ScalarExpression, { type: "jsonPath" }>["path"]) =>
	path.every(
		(segment) =>
			typeof segment === "string" &&
			segment.isWellFormed() &&
			!segment.includes("\0") &&
			!/^\s*[+-]?\d+\s*$/.test(segment),
	)
		? `strict $${path.map((segment) => `.${JSON.stringify(segment)}`).join("")}`
		: undefined;

const compileTypedJsonPathCast = (
	expr: Extract<ScalarExpression, { type: "cast" }>,
	ctx: Context,
): undefined | SqlFragment => {
	if (
		(expr.target !== "text" && expr.target !== "boolean" && expr.target !== "number") ||
		expr.expr.type !== "jsonPath" ||
		expressionKind(expr.expr.expr, ctx.scope) !== "json"
	) {
		return undefined;
	}
	const path = strictObjectPath(expr.expr.path);
	if (path === undefined) {
		return undefined;
	}
	const kind = expr.target === "text" ? "string" : expr.target;
	const typed = `${path} ? (@.type() == "${kind}")${expr.target === "number" ? ".double()" : ""}`;
	const value = sql`(jsonb_path_query_first(${compileExpression(expr.expr.expr, ctx)}, ${typed}::jsonpath, '{}'::jsonb, true) #>> '{}')`;
	return expr.target === "text" ? value : sql`${value}::${sql.raw(castSqlType(expr.target))}`;
};

const compileCast = (
	expr: Extract<ScalarExpression, { type: "cast" }>,
	ctx: Context,
): SqlFragment => {
	const sourceKind = expressionKind(expr.expr, ctx.scope);
	if (expr.target === "json") {
		return compileJsonValue(expr.expr, ctx);
	}
	if (expr.expr.type === "first" && sourceKind === "json") {
		const first = expr.expr;
		return compileFirst(first, ctx, (childCtx) =>
			compileCast({ type: "cast", expr: first.select, target: expr.target }, childCtx),
		);
	}
	if (expr.expr.type === "coalesce" && sourceKind === "json") {
		const branches = expr.expr.values.map(
			(value) =>
				sql`WHEN ${compileJsonValue(value, ctx)} IS NOT NULL THEN ${compileCast(
					{ expr: value, type: "cast", target: expr.target },
					ctx,
				)}`,
		);
		return sql`CASE ${sql.join(branches, sql` `)} ELSE ${typedNull(expr.target)} END`;
	}
	const typedPath = compileTypedJsonPathCast(expr, ctx);
	if (typedPath) {
		return typedPath;
	}
	if (sourceKind === expr.target) {
		return compileExpression(expr.expr, ctx);
	}
	if (sourceKind === "json") {
		if (expr.target === "text") {
			return bindCastOperand(
				expr.expr,
				ctx,
				compileJsonValue(expr.expr, ctx),
				(value) => sql`CASE WHEN jsonb_typeof(${value}) = 'string' THEN (${value} #>> '{}') END`,
			);
		}
		let jsonType = "boolean";
		if (expr.target === "number") {
			jsonType = "number";
		} else if (expr.target === "date") {
			jsonType = "string";
		}
		const sqlType = castSqlType(expr.target);
		return bindCastOperand(expr.expr, ctx, compileJsonValue(expr.expr, ctx), (value) => {
			const text = sql`(${value} #>> '{}')`;
			const valid = expr.target === "boolean" ? sql`true` : safeInputValid(text, expr.target);
			return sql`(CASE WHEN jsonb_typeof(${value}) = ${jsonType} AND ${valid} THEN ${text} END)::${sql.raw(sqlType)}`;
		});
	}
	if (sourceKind === "text" && expr.target !== "text") {
		const sqlType = castSqlType(expr.target);
		return bindCastOperand(
			expr.expr,
			ctx,
			compileExpression(expr.expr, ctx),
			(value) =>
				sql`(CASE WHEN ${safeInputValid(value, expr.target)} THEN ${value} END)::${sql.raw(sqlType)}`,
		);
	}
	if (expr.target === "text") {
		return compileTextValue(expr.expr, ctx);
	}
	return typedNull(expr.target);
};

const compileTextValue = (expr: ScalarExpression, ctx: Context): SqlFragment => {
	const kind = expressionKind(expr, ctx.scope);
	if (kind === "null") {
		return sql`NULL::text`;
	}
	if (kind === "json") {
		return sql`NULLIF((${compileJsonValue(expr, ctx)} #>> '{}'), 'null')`;
	}
	if (kind === "text") {
		return compileExpression(expr, ctx);
	}
	return sql`(${compileExpression(expr, ctx)})::text`;
};

const compileTextTransform = (
	expr: Extract<ScalarExpression, { type: "transform" }>,
	ctx: Context,
) => {
	const value = compileTextValue(expr.expr, ctx);
	const camelCase = sql`regexp_replace(${value}, ${String.raw`([a-z0-9])([A-Z])`}, ${String.raw`\1 \2`}, 'g')`;
	if (expr.name === "titleCase") {
		return sql`initcap(regexp_replace(${camelCase}, ${"[^A-Za-z0-9]+"}, ${" "}, 'g'))`;
	}
	const separated = sql`regexp_replace(${camelCase}, ${"[^A-Za-z0-9]+"}, ${"-"}, 'g')`;
	return sql`btrim(lower(${separated}), '-')`;
};

const compileConditional = (
	expr: Extract<ScalarExpression, { type: "conditional" }>,
	ctx: Context,
) => {
	const json = expressionKind(expr, ctx.scope) === "json";
	const compileBranch = (branch: ScalarExpression) =>
		json ? compileJsonValue(branch, ctx) : compileExpression(branch, ctx);
	return sql`CASE WHEN ${compilePredicate(expr.condition, ctx)} THEN ${compileBranch(expr.whenTrue)} ELSE ${compileBranch(expr.whenFalse)} END`;
};

const compileUnary = (
	expr: Extract<ScalarExpression, { type: "floor" | "round" | "integer" }>,
	ctx: Context,
) => {
	const value = compileCast({ type: "cast", expr: expr.expr, target: "number" }, ctx);
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
	ctx: Context,
) => {
	const left = compileCast({ type: "cast", expr: expr.left, target: "number" }, ctx);
	const right = compileCast({ type: "cast", expr: expr.right, target: "number" }, ctx);
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

const fusedAggregate = (
	expr: Extract<ScalarExpression, { type: "aggregate" }>,
	ctx: Context,
): undefined | SqlFragment => {
	if (!ctx.fused) {
		return undefined;
	}
	const group = ctx.scope.groups.get(stableStringify(expr.query));
	const measure = group?.measures.get(stableStringify(expr.aggregation));
	return group && measure ? qualifiedIdentifier(group.alias, measure.alias) : undefined;
};

const hoistedKey = (expr: ScalarExpression, ctx: Context): undefined | SqlFragment => {
	const column = ctx.hoisted ? jsonKeyColumn(expr) : undefined;
	if (!column) {
		return undefined;
	}
	const owner = ownerScope(ctx.scope, column.tableAlias);
	const key = owner.hoisted.get(column.tableAlias)?.keys.get(stableStringify(expr));
	const table = owner.tables.get(column.tableAlias);
	return key && table ? qualifiedIdentifier(table.sqlAlias, key.column) : undefined;
};

const compileExpression = (expr: ScalarExpression, ctx: Context): SqlFragment => {
	const key = hoistedKey(expr, ctx);
	if (key) {
		return key;
	}
	if (expr.type === "pluginId") {
		if (expr.reference.kind !== "local") {
			throw new Error("RyotQL compiler received an unresolved plugin reference");
		}
		return sql`${expr.reference.pluginId}::text`;
	}
	if (expr.type === "literal") {
		return compileLiteral(expr);
	}
	if (expr.type === "cast") {
		return compileCast(expr, ctx);
	}
	if (expr.type === "currentDate") {
		return sql`(date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')`;
	}
	if (expr.type === "dateBucket") {
		return sql`date_trunc(${expr.bucket}, ${compileExpression(expr.expr, ctx)}, ${expr.timeZone})`;
	}
	if (expr.type === "localDate") {
		return sql`to_char(${compileExpression(expr.expr, ctx)} AT TIME ZONE ${expr.timeZone}, 'YYYY-MM-DD')`;
	}
	if (expr.type === "localHour") {
		return sql`extract(hour from (${compileExpression(expr.expr, ctx)} AT TIME ZONE ${expr.timeZone}))`;
	}
	if (expr.type === "exists") {
		return compileExists(expr, ctx);
	}
	if (expr.type === "arithmetic") {
		return compileArithmetic(expr, ctx);
	}
	if (expr.type === "concat") {
		return sql`concat(${sql.join(
			expr.values.map((value) => compileTextValue(value, ctx)),
			sql`, `,
		)})`;
	}
	if (expr.type === "conditional") {
		return compileConditional(expr, ctx);
	}
	if (expr.type === "transform") {
		return compileTextTransform(expr, ctx);
	}
	if (expr.type === "isNotNull") {
		return sql`(${compileExpression(expr.expr, ctx)} IS NOT NULL)`;
	}
	if (expr.type === "floor" || expr.type === "integer" || expr.type === "round") {
		return compileUnary(expr, ctx);
	}
	if (expr.type === "aggregate") {
		return fusedAggregate(expr, ctx) ?? compileAggregate(expr, ctx);
	}
	if (expr.type === "first") {
		return compileFirst(expr, ctx, (childCtx) => compileExpression(expr.select, childCtx));
	}
	if (expr.type === "jsonPath") {
		return sql`NULLIF(jsonb_extract_path(${compileJsonValue(expr.expr, ctx)}, ${sql.join(
			expr.path.map((segment) => sql`${String(segment)}`),
			sql`, `,
		)}), 'null'::jsonb)`;
	}
	if (expr.type === "jsonElement") {
		if (ctx.element === undefined) {
			throw new Error("RyotQL compiler received a JSON element outside an array operator");
		}
		return sql.raw(`${ctx.element}.elem`);
	}
	if (expr.type === "jsonExists") {
		return compileJsonArrayExists(expr, ctx);
	}
	if (expr.type === "jsonFirst") {
		return compileJsonArrayFirst(expr, ctx);
	}
	if (expr.type === "jsonCount") {
		return compileJsonArrayCount(expr, ctx);
	}
	if (expr.type === "coalesce") {
		const json = expressionKind(expr, ctx.scope) === "json";
		return sql`COALESCE(${sql.join(
			expr.values.map((value) =>
				json ? compileJsonValue(value, ctx) : compileExpression(value, ctx),
			),
			sql`, `,
		)})`;
	}
	const table = lookupTable(ctx.scope, expr.tableAlias);
	const field = resolveCatalogField(table.table, expr.field, ctx.scope.execution);
	if (!field) {
		throw new Error(`RyotQL compiler received unknown field '${expr.field}'`);
	}
	const execution = ctx.scope.execution;
	return field.resolve({
		sqlAlias: table.sqlAlias,
		userId: execution.type === "user" ? execution.userId : null,
		language: execution.type === "user" ? execution.language : null,
	});
};

const expressionNullable = (expr: ScalarExpression, ctx: Context): boolean => {
	if (expr.type === "literal") {
		return expr.value === null;
	}
	if (expr.type === "localDate") {
		return expressionNullable(expr.expr, ctx);
	}
	if (
		expr.type === "pluginId" ||
		expr.type === "currentDate" ||
		expr.type === "exists" ||
		expr.type === "isNotNull" ||
		expr.type === "jsonExists" ||
		expr.type === "jsonCount"
	) {
		return false;
	}
	if (expr.type === "column") {
		const table = lookupTable(ctx.scope, expr.tableAlias);
		const field = resolveCatalogField(table.table, expr.field, ctx.scope.execution);
		return (
			table.joinedNullable ||
			(!table.table.primaryKey.includes(expr.field) && (field?.nullable ?? true))
		);
	}
	return true;
};

const likePattern = (
	operand: ScalarExpression,
	ctx: Context,
	match: "contains" | "startsWith",
): SqlFragment => {
	const leading = match === "contains" ? "%" : "";
	if (operand.type === "literal" && typeof operand.value === "string") {
		const escaped = operand.value
			.replaceAll("\\", "\\\\")
			.replaceAll("%", "\\%")
			.replaceAll("_", "\\_");
		return sql`${`${leading}${escaped}%`}`;
	}
	const escaped = sql`replace(replace(replace(${compileExpression(operand, ctx)}, ${"\\"}, ${"\\\\"}), ${"%"}, ${"\\%"}), ${"_"}, ${"\\_"})`;
	return sql`(${leading} || ${escaped} || ${"%"})`;
};

const compilePredicate = (predicate: Predicate, ctx: Context, total = false): SqlFragment => {
	if (predicate.type === "exists") {
		return compileExists(predicate, ctx);
	}
	if (predicate.type === "jsonExists") {
		return compileJsonArrayExists(predicate, ctx);
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
			expressionKind(predicate.left, ctx.scope) === "json" &&
			expressionKind(predicate.right, ctx.scope) === "json"
		) {
			const jsonComparison = sql`${compileJsonValue(predicate.left, ctx)} ${operator} ${compileJsonValue(predicate.right, ctx)}`;
			return total ? sql`COALESCE(${jsonComparison}, false)` : jsonComparison;
		}
		const comparison = sql`${compileExpression(predicate.left, ctx)} ${operator} ${compileExpression(predicate.right, ctx)}`;
		return total &&
			(expressionNullable(predicate.left, ctx) || expressionNullable(predicate.right, ctx))
			? sql`COALESCE(${comparison}, false)`
			: comparison;
	}
	if (predicate.type === "and" || predicate.type === "or") {
		if (predicate.predicates.length === 0) {
			return predicate.type === "and" ? sql`true` : sql`false`;
		}
		const separator = predicate.type === "and" ? sql` AND ` : sql` OR `;
		return sql`(${sql.join(
			predicate.predicates.map((value) => compilePredicate(value, ctx, total)),
			separator,
		)})`;
	}
	if (predicate.type === "not") {
		return sql`(NOT ${compilePredicate(predicate.predicate, ctx, true)})`;
	}
	if (predicate.type === "isNull" || predicate.type === "isNotNull") {
		const operator = predicate.type === "isNull" ? sql`IS NULL` : sql`IS NOT NULL`;
		return sql`(${compileExpression(predicate.expr, ctx)} ${operator})`;
	}
	if (predicate.type === "contains") {
		if (expressionKind(predicate.left, ctx.scope) === "json") {
			const containment = sql`${compileJsonValue(predicate.left, ctx)} @> ${compileJsonValue(predicate.right, ctx)}`;
			return total ? sql`COALESCE(${containment}, false)` : containment;
		}
		const match = sql`${compileExpression(predicate.left, ctx)} COLLATE "C" ILIKE ${likePattern(predicate.right, ctx, "contains")}`;
		return total ? sql`COALESCE(${match}, false)` : match;
	}
	if (predicate.type === "startsWith") {
		const match = sql`${compileExpression(predicate.left, ctx)} COLLATE "C" ILIKE ${likePattern(predicate.right, ctx, "startsWith")}`;
		return total ? sql`COALESCE(${match}, false)` : match;
	}
	const membership = predicate satisfies Extract<Predicate, { type: "in" }>;
	if (membership.values.length === 0) {
		return sql`false`;
	}
	if (expressionKind(membership.expr, ctx.scope) === "json") {
		const jsonMembership = sql`${compileJsonValue(membership.expr, ctx)} IN (${sql.join(
			membership.values.map((value) => compileJsonValue(value, ctx)),
			sql`, `,
		)})`;
		return total ? sql`COALESCE(${jsonMembership}, false)` : jsonMembership;
	}
	const comparison = sql`${compileExpression(membership.expr, ctx)} IN (${sql.join(
		membership.values.map((value) => compileExpression(value, ctx)),
		sql`, `,
	)})`;
	return total &&
		(expressionNullable(membership.expr, ctx) ||
			membership.values.some((value) => expressionNullable(value, ctx)))
		? sql`COALESCE(${comparison}, false)`
		: comparison;
};

const deniedTable = (table: CatalogTable) =>
	new Error(`RyotQL compiler received denied table '${table.name}'`);

const userVisibilityCondition = (
	table: CatalogTable,
	scope: Extract<RyotQLExecutionScope, { type: "user" }>,
): null | SqlFragment => {
	const policy = table.visibility.user;
	if (!policy) {
		throw deniedTable(table);
	}
	if (policy.type === "public") {
		return null;
	}
	if (policy.type === "self") {
		return sql`${identifier(policy.column)} = ${scope.userId}`;
	}
	if (policy.type === "parentOwned") {
		const column = qualifiedIdentifier(table.name, policy.column);
		const parentTable = identifier(policy.parentTable);
		const parentColumn = qualifiedIdentifier(policy.parentTable, policy.parentColumn);
		const parentOwnerColumn = qualifiedIdentifier(policy.parentTable, policy.parentOwnerColumn);
		return sql`EXISTS (SELECT 1 FROM ${parentTable} WHERE ${parentColumn} = ${column} AND ${parentOwnerColumn} = ${scope.userId})`;
	}
	const column = identifier(policy.column);
	const owner = policy.includeGlobal
		? sql`(${column} = ${scope.userId} OR ${column} IS NULL)`
		: sql`${column} = ${scope.userId}`;
	return policy.where ? sql`${owner} AND (${sql.raw(policy.where)})` : owner;
};

const ownedSlugsCondition = (
	ownerColumn: string,
	slugColumn: string,
	slugs: readonly string[],
	pluginId: string,
): SqlFragment =>
	sql`${identifier(ownerColumn)} = ${pluginId}::text AND ${identifier(slugColumn)} IN (${sql.join(
		slugs.map((slug) => sql`${slug}::text`),
		sql`, `,
	)})`;

const pluginVisibilityCondition = (
	table: CatalogTable,
	scope: Extract<RyotQLExecutionScope, { type: "plugin" }>,
): SqlFragment => {
	const policy = table.visibility.plugin;
	if (!policy) {
		throw deniedTable(table);
	}
	if (policy.type === "schemaDefinition") {
		let declared: readonly string[];
		switch (policy.kind) {
			case "event":
				if (scope.eventSchemas.length === 0) {
					return sql`false`;
				}
				return sql`${identifier("plugin_id")} = ${scope.pluginId}::text AND (${sql.join(
					scope.eventSchemas.map(
						(event) =>
							sql`(${identifier("slug")} = ${event.eventSchemaSlug}::text AND ${identifier("entity_schema_slug")} = ${event.entitySchemaSlug}::text)`,
					),
					sql` OR `,
				)})`;
			case "entity":
				declared = scope.entitySchemaSlugs;
				break;
			case "signal":
				declared = scope.signalSchemaSlugs;
				break;
			case "relationship":
				declared = scope.relationshipSchemaSlugs;
				break;
		}
		return declared.length === 0
			? sql`false`
			: ownedSlugsCondition("plugin_id", "slug", declared, scope.pluginId);
	}
	if (policy.type === "eventDefinition") {
		if (scope.eventSchemas.length === 0) {
			return sql`false`;
		}
		const ownership = scope.eventSchemas.map(
			(eventSchema) =>
				sql`(${qualifiedIdentifier(table.name, "event_schema_slug")} = ${eventSchema.eventSchemaSlug}::text AND event_scope_entity.entity_schema_slug = ${eventSchema.entitySchemaSlug}::text)`,
		);
		return sql`EXISTS (
			SELECT 1 FROM entity event_scope_entity
			WHERE event_scope_entity.id = ${qualifiedIdentifier(table.name, "entity_id")}
			AND event_scope_entity.entity_schema_plugin_id = ${scope.pluginId}::text
			AND ${qualifiedIdentifier(table.name, "event_schema_plugin_id")} = ${scope.pluginId}::text
			AND (${sql.join(ownership, sql` OR `)})
		)`;
	}
	const ownedSlugs = scope[policy.ownership];
	if (ownedSlugs.length === 0) {
		return sql`false`;
	}
	const ownership = ownedSlugsCondition(
		policy.ownerColumn,
		policy.column,
		ownedSlugs,
		scope.pluginId,
	);
	if (policy.ownership === "relationshipSchemaSlugs") {
		return sql`${ownership} AND EXISTS (
			SELECT 1 FROM definition_relationship_schema declaration
			JOIN entity relationship_source ON relationship_source.id = ${qualifiedIdentifier(table.name, "source_entity_id")}
			JOIN entity relationship_target ON relationship_target.id = ${qualifiedIdentifier(table.name, "target_entity_id")}
			WHERE declaration.plugin_revision_id = ${scope.pluginRevisionId}
			AND declaration.slug = ${qualifiedIdentifier(table.name, "relationship_schema_slug")}
			AND relationship_source.entity_schema_plugin_id = ${scope.pluginId}
			AND relationship_target.entity_schema_plugin_id = ${scope.pluginId}
			AND (declaration.source_entity_schema_slug IS NULL OR declaration.source_entity_schema_slug = relationship_source.entity_schema_slug)
			AND (declaration.target_entity_schema_slug IS NULL OR declaration.target_entity_schema_slug = relationship_target.entity_schema_slug)
		)`;
	}
	return policy.globalOnly ? sql`${identifier("user_id")} IS NULL AND ${ownership}` : ownership;
};

const authorizedTable = (table: CatalogTable, scope: RyotQLExecutionScope): SqlFragment => {
	if (!canAccessCatalogTable(table, scope)) {
		throw deniedTable(table);
	}
	const definition = table.visibility.plugin;
	if (definition?.type === "schemaDefinition") {
		const context = definitionReadContext(scope);
		if (context) {
			const pinned = pinnedDefinitionSource(
				definition.kind,
				context,
				scope.type === "user" ? scope.userId : null,
			);
			if (scope.type === "plugin") {
				return sql`(SELECT * FROM (${pinned}) ${identifier(table.name)} WHERE ${pluginVisibilityCondition(table, scope)})`;
			}
			if (scope.type === "user") {
				const fields = sql.join(
					Object.entries(table.fields).map(
						([field, catalogField]) =>
							sql`${catalogField.resolve({ language: scope.language, sqlAlias: "definition_read" })} AS ${identifier(field.replaceAll(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`))}`,
					),
					sql`, `,
				);
				return sql`(SELECT ${fields} FROM ${identifier(table.name)} definition_read WHERE ${userVisibilityCondition(table, scope)} AND definition_read.plugin_id IS DISTINCT FROM ${context.pluginId}::text UNION ALL SELECT ${fields} FROM (${pinned}) definition_read WHERE EXISTS (SELECT 1 FROM user_plugin available WHERE available.user_id = ${scope.userId} AND available.plugin_id = ${context.pluginId} AND available.is_definition_effective))`;
			}
		}
	}
	let condition: null | SqlFragment = null;
	if (scope.type === "user") {
		condition = userVisibilityCondition(table, scope);
	} else if (scope.type === "plugin") {
		condition = pluginVisibilityCondition(table, scope);
	}
	return condition
		? sql`(SELECT * FROM ${identifier(table.name)} WHERE ${condition})`
		: sql`(SELECT * FROM ${identifier(table.name)})`;
};

const runtimeKindSql = (value: SqlFragment) =>
	sql`CASE jsonb_typeof(${value}) WHEN 'string' THEN 'text' WHEN 'number' THEN 'number' WHEN 'boolean' THEN 'boolean' WHEN 'object' THEN 'json' WHEN 'array' THEN 'json' ELSE 'null' END`;

const outputKind = (expr: ScalarExpression, ctx: Context): SqlFragment => {
	if (expr.type === "jsonPath") {
		return runtimeKindSql(compileExpression(expr, ctx));
	}
	if (expr.type === "conditional" && expressionKind(expr, ctx.scope) === "json") {
		return runtimeKindSql(compileJsonValue(expr, ctx));
	}
	if (expr.type === "coalesce" && expressionKind(expr, ctx.scope) === "json") {
		const cases = expr.values.map(
			(value) =>
				sql`WHEN ${compileJsonValue(value, ctx)} IS NOT NULL THEN ${outputKind(value, ctx)}`,
		);
		return sql`CASE ${sql.join(cases, sql` `)} ELSE 'null' END`;
	}
	if (expr.type === "first") {
		return sql`COALESCE(${compileFirst(expr, ctx, (childCtx) => outputKind(expr.select, childCtx))}, 'null')`;
	}
	if (expr.type === "jsonFirst") {
		return sql`COALESCE(${compileJsonArrayFirst(expr, ctx, (elementCtx) => outputKind(expr.select, elementCtx))}, 'null')`;
	}
	const kind = expressionKind(expr, ctx.scope);
	if (kind === "null") {
		return sql`'null'`;
	}
	return sql`CASE WHEN ${compileExpression(expr, ctx)} IS NULL THEN 'null' ELSE ${sql.raw(`'${kind}'`)} END`;
};

const hasRuntimeOutputKind = (expr: ScalarExpression, scope: AliasScope): boolean => {
	if (expr.type === "jsonPath") {
		return true;
	}
	if (expr.type === "first") {
		return hasRuntimeOutputKind(expr.select, correlatedAliasScope(expr.query, scope));
	}
	if (expr.type === "jsonFirst") {
		return hasRuntimeOutputKind(expr.select, scope);
	}
	return (
		(expr.type === "conditional" || expr.type === "coalesce") &&
		expressionKind(expr, scope) === "json"
	);
};

const compileOutputColumns = (
	expr: ScalarExpression,
	ctx: Context,
	valueAlias: string,
	kindAlias: string,
) => {
	const value = sql`${compileExpression(expr, ctx)} AS ${identifier(valueAlias)}`;
	return hasRuntimeOutputKind(expr, ctx.scope)
		? [value, sql`${outputKind(expr, ctx)} AS ${identifier(kindAlias)}`]
		: [value];
};

const relation = (name: string) => identifier(`source_${name}`);

const catalogSource = (table: PlannedTable, execution: RyotQLExecutionScope) => {
	const source = authorizedTable(table.table, execution);
	return (
		table.table.source?.({
			source,
			relation,
			fields: table.fields,
			userId: execution.type === "user" ? execution.userId : null,
		}) ?? { ctes: {}, from: source }
	);
};

const tableSource = (scope: PlannedScope, alias: string, table: PlannedTable) => {
	const hoisted = scope.hoisted.get(alias);
	return hoisted ? identifier(hoisted.name) : catalogSource(table, scope.execution).from;
};

const statementCtes = (root: PlannedScope) => {
	const ctes = new Map<string, SqlFragment>();
	const scopes = planScopes(root);
	for (const scope of scopes) {
		for (const table of scope.tables.values()) {
			if (!table.table.source) {
				continue;
			}
			for (const [name, body] of Object.entries(catalogSource(table, scope.execution).ctes)) {
				ctes.set(`source_${name}`, body);
			}
		}
	}
	for (const scope of scopes) {
		const ctx: Context = { ...rootContext(scope), fused: false, hoisted: false };
		for (const [alias, hoisted] of scope.hoisted) {
			const table = lookupTable(scope, alias);
			const columns = [
				sql.raw(`${table.sqlAlias}.*`),
				...[...hoisted.keys.values()].map(
					(key) => sql`${compileExpression(key.expr, ctx)} AS ${identifier(key.column)}`,
				),
			];
			const local = hoisted.local.map((predicate) => compilePredicate(predicate, ctx));
			ctes.set(
				hoisted.name,
				sql`SELECT ${sql.join(columns, sql`, `)} FROM ${catalogSource(table, scope.execution).from} ${sql.raw(table.sqlAlias)}${
					local.length > 0 ? sql` WHERE ${sql.join(local, sql` AND `)}` : sql``
				}`,
			);
		}
		const materialized = scope.tables.values().next().value;
		if (scope.materializedRoot !== undefined && materialized) {
			ctes.set(
				scope.materializedRoot,
				sql`SELECT * FROM ${authorizedTable(materialized.table, scope.execution)} "materialized"`,
			);
		}
	}
	return ctes;
};

const withCtes = (root: PlannedScope, query: SqlFragment, extra: readonly SqlFragment[] = []) => {
	const ctes = [
		...[...statementCtes(root)].map(
			([name, source]) => sql`${identifier(name)} AS MATERIALIZED (${source})`,
		),
		...extra,
	];
	return ctes.length > 0 ? sql`WITH ${sql.join(ctes, sql`, `)} ${query}` : query;
};

const querySetSql = (
	query: QuerySet,
	ctx: Context,
	additionalConditions: readonly SqlFragment[] = [],
): SqlFragment => {
	const { scope } = ctx;
	const joinCtx: Context = { ...ctx, fused: false };
	const hoistedPredicates = new Set(
		[...scope.hoisted.values()].flatMap((hoisted) =>
			hoisted.local.map((predicate) => stableStringify(predicate)),
		),
	);
	const condition = (predicate: Predicate, conditionCtx: Context) => {
		if (hoistedPredicates.size === 0) {
			return compilePredicate(predicate, conditionCtx);
		}
		const remaining = conjuncts(predicate).filter(
			(conjunct) => !hoistedPredicates.has(stableStringify(conjunct)),
		);
		return remaining.length > 0
			? sql`(${sql.join(
					remaining.map((conjunct) => compilePredicate(conjunct, conditionCtx)),
					sql` AND `,
				)})`
			: sql`true`;
	};
	const root = lookupTable(scope, query.from.alias);
	const rootSource =
		scope.materializedRoot === undefined
			? tableSource(scope, query.from.alias, root)
			: identifier(scope.materializedRoot);
	const joins = (query.joins ?? []).map((join) => {
		if (join.type === "jsonElements") {
			const elements = lookupTable(scope, join.alias);
			const array = compileExpression(join.expr, joinCtx);
			const source = sql`jsonb_array_elements(CASE WHEN jsonb_typeof(${array}) = 'array' THEN ${array} ELSE '[]'::jsonb END) WITH ORDINALITY AS ${sql.raw(elements.sqlAlias)}(${identifier("value")}, ${identifier("ordinal")})`;
			return join.mode === "inner"
				? sql`CROSS JOIN LATERAL ${source}`
				: sql`LEFT JOIN LATERAL ${source} ON true`;
		}
		const joined = lookupTable(scope, join.table.alias);
		const joinType = join.type === "inner" ? sql`INNER JOIN` : sql`LEFT JOIN`;
		return sql`${joinType} ${tableSource(scope, join.table.alias, joined)} ${sql.raw(joined.sqlAlias)} ON ${condition(join.on, joinCtx)}`;
	});
	const aggregates = [...scope.groups.values()].map((group) => {
		const groupCtx: Context = { ...ctx, scope: group.scope };
		const measures = [...group.measures.values()].map(
			({ alias, aggregation }) =>
				sql`${compileAggregation(aggregation, groupCtx)} AS ${identifier(alias)}`,
		);
		return sql`CROSS JOIN LATERAL (SELECT ${sql.join(measures, sql`, `)} ${querySetSql(group.query, groupCtx)}) ${identifier(group.alias)}`;
	});
	const conditions = [
		...(query.where ? [condition(query.where, ctx)] : []),
		...additionalConditions,
	];
	return sql`
		FROM ${rootSource} ${sql.raw(root.sqlAlias)}
		${sql.join(joins, sql` `)}
		${sql.join(aggregates, sql` `)}
		${conditions.length > 0 ? sql`WHERE ${sql.join(conditions, sql` AND `)}` : sql``}
	`;
};

const isColumnOrder = (expr: ScalarExpression, alias: string, field: string) =>
	expr.type === "column" && expr.tableAlias === alias && expr.field === field;

const orderSql = (
	orders: readonly { readonly kind: ScalarKind; readonly direction: "asc" | "desc" }[],
) =>
	sql.join(
		orders.map((order, index) => {
			const collation = order.kind === "text" ? sql` COLLATE "C"` : sql``;
			const direction = order.direction === "asc" ? sql`ASC` : sql`DESC`;
			return sql`${identifier(`o${index}`)}${collation} ${direction} NULLS LAST`;
		}),
		sql`, `,
	);

const expressionOrderSql = (orders: readonly Order[], ctx: Context) =>
	sql.join(
		orders.map((order) => {
			const expression = compileExpression(order.expr, ctx);
			const collation =
				expressionKind(order.expr, ctx.scope) === "text" ? sql` COLLATE "C"` : sql``;
			const direction = order.direction === "asc" ? sql`ASC` : sql`DESC`;
			return sql`${expression}${collation} ${direction} NULLS LAST`;
		}),
		sql`, `,
	);

const appendPrimaryKeyOrders = (
	query: QuerySet,
	scope: PlannedScope,
	requested: readonly Order[],
): Order[] => {
	const joins = query.joins ?? [];
	const keyOrders = (alias: string, table: CatalogTable) =>
		table.primaryKey
			.filter((field) => !requested.some((order) => isColumnOrder(order.expr, alias, field)))
			.map((field) => ({
				direction: "asc" as const,
				expr: { field, tableAlias: alias, type: "column" as const },
			}));
	return [
		...requested,
		...[
			...joins.flatMap((join) => (join.type === "jsonElements" ? [] : [join.table])),
			query.from,
		].flatMap((reference) => keyOrders(reference.alias, lookupTable(scope, reference.alias).table)),
		...joins.flatMap((join) =>
			join.type === "jsonElements" ? keyOrders(join.alias, jsonElementsTable) : [],
		),
	];
};

const cursorError = () => new RyotQLBadRequest({ reason: { code: "invalid-cursor" } });

const makeCursorValue = (kind: ScalarKind, value: unknown): undefined | CursorValue => {
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
	kinds: readonly ScalarKind[],
	directions: readonly Order["direction"][],
	ownerIdentity: string,
) {
	if (!/^[A-Za-z0-9_-]+$/.test(cursor)) {
		return yield* cursorError();
	}
	const bytes = Buffer.from(cursor, "base64url");
	if (bytes.toString("base64url") !== cursor) {
		return yield* cursorError();
	}
	const decoded = yield* Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown))(
		bytes.toString("utf8"),
	).pipe(Effect.mapError(cursorError));
	if (
		!isObjectRecord(decoded) ||
		decoded["version"] !== CURSOR_VERSION ||
		decoded["ownerIdentity"] !== ownerIdentity ||
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
		if (!isObjectRecord(raw) || typeof raw["kind"] !== "string" || !("value" in raw)) {
			return yield* cursorError();
		}
		if (raw["kind"] === "null") {
			if (raw["value"] !== null) {
				return yield* cursorError();
			}
			values.push({ value: null, kind: "null" });
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

const encodeCursor = (
	values: readonly CursorValue[],
	directions: readonly Order["direction"][],
	ownerIdentity: string,
) =>
	encodeJson({ values, directions, ownerIdentity, version: CURSOR_VERSION }).pipe(
		Effect.map((json) => Buffer.from(json).toString("base64url")),
	);

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

type KeysetColumn = {
	readonly nullable: boolean;
	readonly value: SqlFragment;
	readonly direction: Order["direction"];
};

const keysetPredicate = (columns: readonly KeysetColumn[], values: readonly CursorValue[]) => {
	const terms: SqlFragment[] = [];
	for (const [index, column] of columns.entries()) {
		const current = values[index];
		if (!current || current.kind === "null") {
			continue;
		}
		const prefix = columns.slice(0, index).map((prefixColumn, prefixIndex) => {
			const prefixValue = values[prefixIndex];
			if (!prefixValue) {
				throw new Error("RyotQL compiler received a cursor with missing order values");
			}
			return prefixValue.kind === "null"
				? sql`${prefixColumn.value} IS NOT DISTINCT FROM NULL`
				: sql`${prefixColumn.value} IS NOT DISTINCT FROM ${cursorSqlValue(prefixValue)}`;
		});
		const value = cursorSqlValue(current);
		const orderedExpression =
			current.kind === "text" ? sql`${column.value} COLLATE "C"` : column.value;
		const orderedValue = current.kind === "text" ? sql`${value} COLLATE "C"` : value;
		const operator = column.direction === "asc" ? sql`>` : sql`<`;
		const orderedComparison = sql`${orderedExpression} ${operator} ${orderedValue}`;
		const comparison = column.nullable
			? sql`(${orderedComparison} OR ${column.value} IS NULL)`
			: orderedComparison;
		terms.push(
			prefix.length === 0 ? comparison : sql`(${sql.join(prefix, sql` AND `)} AND ${comparison})`,
		);
	}
	return terms.length === 0 ? sql`false` : sql`(${sql.join(terms, sql` OR `)})`;
};

const compileCursorPredicate = (
	orders: readonly Order[],
	values: readonly CursorValue[],
	ctx: Context,
) =>
	keysetPredicate(
		orders.map((order) => ({
			direction: order.direction,
			value: compileExpression(order.expr, ctx),
			nullable: expressionNullable(order.expr, ctx),
		})),
		values,
	);

const compileExists = (expr: Extract<ScalarExpression, { type: "exists" }>, ctx: Context) =>
	sql`EXISTS (SELECT 1 ${querySetSql(expr.query, correlatedContext(ctx, expr.query))})`;

const compileFirst = (
	expr: Extract<ScalarExpression, { type: "first" }>,
	ctx: Context,
	select: (ctx: Context) => SqlFragment,
) => {
	const childCtx = correlatedContext(ctx, expr.query);
	const orders = appendPrimaryKeyOrders(expr.query, childCtx.scope, expr.orderBy);
	return sql`(SELECT ${select(childCtx)} ${querySetSql(expr.query, childCtx)} ORDER BY ${expressionOrderSql(orders, childCtx)} LIMIT 1)`;
};

const compileAggregate = (expr: Extract<ScalarExpression, { type: "aggregate" }>, ctx: Context) => {
	const childCtx = correlatedContext(ctx, expr.query);
	return sql`(SELECT ${compileAggregation(expr.aggregation, childCtx)} ${querySetSql(expr.query, childCtx)})`;
};

const compileJsonArrayFrom = (array: ScalarExpression, ctx: Context) => {
	const arraySql = compileExpression(array, ctx);
	const alias = `j${ctx.elementDepth}`;
	return {
		elementCtx: { ...ctx, element: alias, elementDepth: ctx.elementDepth + 1 },
		from: sql`jsonb_array_elements(CASE WHEN jsonb_typeof(${arraySql}) = 'array' THEN ${arraySql} ELSE '[]'::jsonb END) AS ${sql.raw(alias)}(elem)`,
	};
};

const compileJsonArrayExists = (
	expr: Extract<ScalarExpression, { type: "jsonExists" }>,
	ctx: Context,
) => {
	const { from, elementCtx } = compileJsonArrayFrom(expr.array, ctx);
	return expr.where
		? sql`EXISTS (SELECT 1 FROM ${from} WHERE ${compilePredicate(expr.where, elementCtx)})`
		: sql`EXISTS (SELECT 1 FROM ${from})`;
};

const compileJsonArrayFirst = (
	expr: Extract<ScalarExpression, { type: "jsonFirst" }>,
	ctx: Context,
	select: (ctx: Context) => SqlFragment = (elementCtx) =>
		compileExpression(expr.select, elementCtx),
) => {
	const { from, elementCtx } = compileJsonArrayFrom(expr.array, ctx);
	const where = expr.where ? sql`WHERE ${compilePredicate(expr.where, elementCtx)}` : sql``;
	return sql`(SELECT ${select(elementCtx)} FROM ${from} ${where} ORDER BY ${expressionOrderSql(expr.orderBy, elementCtx)} LIMIT 1)`;
};

const compileJsonArrayCount = (
	expr: Extract<ScalarExpression, { type: "jsonCount" }>,
	ctx: Context,
) => {
	if (!expr.where) {
		return bindCastOperand(
			expr.array,
			ctx,
			compileExpression(expr.array, ctx),
			(array) =>
				sql`(CASE WHEN jsonb_typeof(${array}) = 'array' THEN jsonb_array_length(${array}) ELSE 0 END)::double precision`,
		);
	}
	const { from, elementCtx } = compileJsonArrayFrom(expr.array, ctx);
	return sql`(SELECT COUNT(*)::double precision FROM ${from} WHERE ${compilePredicate(expr.where, elementCtx)})`;
};

const compileAggregation = (aggregation: AggregationSpec, ctx: Context, numericMinMax = false) => {
	if (aggregation.function === "count") {
		return sql`COUNT(*)::double precision`;
	}
	if (aggregation.function === "countDistinct") {
		return sql`COUNT(DISTINCT ${compileExpression(aggregation.expr, ctx)})::double precision`;
	}
	if (aggregation.function === "sum" || aggregation.function === "average" || numericMinMax) {
		const operand = compileCast({ type: "cast", target: "number", expr: aggregation.expr }, ctx);
		if (aggregation.function === "sum") {
			return sql`SUM(${operand})`;
		}
		if (aggregation.function === "average") {
			return sql`AVG(${operand})`;
		}
		return aggregation.function === "minimum" ? sql`MIN(${operand})` : sql`MAX(${operand})`;
	}
	const operand = compileExpression(aggregation.expr, ctx);
	return aggregation.function === "minimum" ? sql`MIN(${operand})` : sql`MAX(${operand})`;
};

const compileInclude = (include: ExpandedInclude, ctx: Context): SqlFragment => {
	const includeCtx = correlatedContext(ctx, include);
	const orders = appendPrimaryKeyOrders(include, includeCtx.scope, include.orderBy);
	const ordering = orderSql(
		orders.map((order) => ({
			direction: order.direction,
			kind: expressionKind(order.expr, includeCtx.scope),
		})),
	);
	const fieldValues = include.fields.flatMap((field) =>
		hasRuntimeOutputKind(field.expr, includeCtx.scope)
			? [compileExpression(field.expr, includeCtx), outputKind(field.expr, includeCtx)]
			: [compileExpression(field.expr, includeCtx)],
	);
	const nestedValues = (include.include ?? []).map((nested) => compileInclude(nested, includeCtx));
	const item = sql`jsonb_build_array(${sql.join([...fieldValues, ...nestedValues], sql`, `)})`;
	const orderColumns = orders.map(
		(order, index) =>
			sql`${compileExpression(order.expr, includeCtx)} AS ${identifier(`o${index}`)}`,
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
				${querySetSql(include, includeCtx)}
				ORDER BY ${expressionOrderSql(orders, includeCtx)}
				LIMIT ${include.limit + 1}
			) "orderedIncludeRows"
		) "indexedIncludeRows"
	)`;
};

const compileCursorColumn = (expr: ScalarExpression, ctx: Context) => {
	const value = compileExpression(expr, ctx);
	return expressionKind(expr, ctx.scope) === "date"
		? sql`to_char(${value} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`
		: value;
};

const compileRowsQuery = (
	query: RowsQuery,
	plan: PlannedScope,
	orders: readonly Order[],
	cursor: undefined | readonly CursorValue[],
): SqlFragment => {
	const ctx = rootContext(plan);
	const fieldColumns = query.output.fields.flatMap((field, index) =>
		compileOutputColumns(field.expr, ctx, `f${index}v`, `f${index}k`),
	);
	const orderColumns = orders.map(
		(order, index) => sql`${compileCursorColumn(order.expr, ctx)} AS ${identifier(`o${index}`)}`,
	);
	const includeColumns = (query.output.include ?? []).map(
		(include, index) => sql`${compileInclude(include, ctx)} AS ${identifier(`i${index}`)}`,
	);
	const columns = [...fieldColumns, ...includeColumns, ...orderColumns];
	const cursorCondition = cursor ? [compileCursorPredicate(orders, cursor, ctx)] : [];
	return withCtes(
		plan,
		sql`
		SELECT ${sql.join(columns, sql`, `)}
		${querySetSql(query, ctx, cursorCondition)}
		ORDER BY ${expressionOrderSql(orders, ctx)}
		LIMIT ${query.output.pagination.limit + 1}
	`,
	);
};

type AggregateOrder = {
	readonly column: string;
	readonly kind: ScalarKind;
	readonly direction: Order["direction"];
};

// Group keys missing from the requested order break ties, so pages are stable and resumable.
const aggregateOrders = (query: AggregateQuery, plan: PlannedScope): AggregateOrder[] => {
	const groups = query.output.groupBy ?? [];
	const requested = (query.output.orderBy ?? []).map((order): AggregateOrder => {
		const groupIndex = groups.findIndex((group) => group.key === order.key);
		const group = groups[groupIndex];
		if (group !== undefined) {
			return {
				column: `g${groupIndex}v`,
				direction: order.direction,
				kind: expressionKind(group.expr, plan),
			};
		}
		const measureIndex = query.output.measures.findIndex((measure) => measure.key === order.key);
		const measure = query.output.measures[measureIndex];
		if (measure === undefined) {
			throw new Error(`RyotQL compiler received unknown aggregate order key '${order.key}'`);
		}
		return {
			direction: order.direction,
			column: `m${measureIndex}`,
			kind: aggregationMeasureKind(measure, plan) ?? "number",
		};
	});
	const ordered = new Set(requested.map((order) => order.column));
	const tieBreakers = groups.flatMap((group, index): AggregateOrder[] => {
		const kind = expressionKind(group.expr, plan);
		return ordered.has(`g${index}v`) || kind === "json" || hasRuntimeOutputKind(group.expr, plan)
			? []
			: [{ kind, direction: "asc", column: `g${index}v` }];
	});
	return [...requested, ...tieBreakers];
};

const compileAggregateQuery = (
	query: AggregateQuery,
	plan: PlannedScope,
	orders: readonly AggregateOrder[],
	cursor: undefined | readonly CursorValue[],
) => {
	const ctx = rootContext(plan);
	const groups = query.output.groupBy ?? [];
	const groupColumns = groups.flatMap((group, index) =>
		compileOutputColumns(group.expr, ctx, `g${index}v`, `g${index}k`),
	);
	const measureColumns = query.output.measures.map(
		(measure, index) =>
			sql`${compileAggregation(measure.aggregation, ctx)} AS ${identifier(`m${index}`)}`,
	);
	if (groups.length === 0) {
		return withCtes(
			plan,
			sql`SELECT ${sql.join(measureColumns, sql`, `)} ${querySetSql(query, ctx)}`,
		);
	}
	if (query.output.limit === undefined) {
		throw new Error("RyotQL grouped aggregate is missing a limit after validation");
	}
	let groupOrdinal = 1;
	const groupOrdinals = groups.flatMap((group) => {
		const count = hasRuntimeOutputKind(group.expr, plan) ? 2 : 1;
		return Array.from({ length: count }, () => groupOrdinal++);
	});
	const ordering = orders.map((order) => {
		const collation = order.kind === "text" ? sql` COLLATE "C"` : sql``;
		const direction = order.direction === "asc" ? sql`ASC` : sql`DESC`;
		return sql`${identifier(order.column)}${collation} ${direction} NULLS LAST`;
	});
	const after = cursor
		? sql`WHERE ${keysetPredicate(
				orders.map((order) => ({
					nullable: true,
					direction: order.direction,
					value: sql`"aggregateGroups".${identifier(order.column)}`,
				})),
				cursor,
			)}`
		: sql``;
	return withCtes(
		plan,
		sql`
		SELECT * FROM (
			SELECT ${sql.join([...groupColumns, ...measureColumns], sql`, `)}
			${querySetSql(query, ctx)}
			GROUP BY ${sql.join(
				groupOrdinals.map((ordinal) => sql.raw(String(ordinal))),
				sql`, `,
			)}
		) "aggregateGroups"
		${after}
		ORDER BY ${sql.join(ordering, sql`, `)}
		LIMIT ${query.output.limit + 1}
	`,
	);
};
const TIME_SERIES_BUCKET_STEPS: Record<TimeSeriesOutput["time"]["bucket"], string> = {
	day: "1 day",
	hour: "1 hour",
	week: "7 days",
	year: "1 year",
	month: "1 month",
};

const pgDialect = new PgDialect();

type RyotQLResultBudget = { remainingBytes: number; readonly limitBytes: number };

// PostgreSQL measures the result as JSON text and withholds every row once the budget is exceeded,
// so oversized results never reach the backend.
const boundedQuery = (query: SqlFragment, remainingBytes: number) =>
	sql`WITH "ryotqlRows" AS MATERIALIZED (SELECT "ryotqlQuery".*, row_number() OVER () AS "ryotqlOrdinal" FROM (${query}) AS "ryotqlQuery"), "ryotqlSize" AS (SELECT coalesce(sum(octet_length(to_jsonb("ryotqlRows")::text)), 0) AS "ryotqlBytes" FROM "ryotqlRows") SELECT "ryotqlRows".*, "ryotqlSize"."ryotqlBytes" FROM "ryotqlSize" LEFT JOIN "ryotqlRows" ON "ryotqlSize"."ryotqlBytes" <= ${remainingBytes} ORDER BY "ryotqlRows"."ryotqlOrdinal"`;

const executeSql = Effect.fn("executeRyotQLSql")(function* (
	query: SqlFragment,
	queryName: string,
	db: EffectPgDatabase,
	budget: undefined | RyotQLResultBudget,
) {
	const statementQuery = budget === undefined ? query : boundedQuery(query, budget.remainingBytes);
	const { sql: statement } = pgDialect.sqlToQuery(statementQuery);
	yield* Effect.logTrace("RyotQL SQL generated").pipe(
		Effect.annotateLogs({ queryName, sql: statement }),
	);
	const rows = yield* mapDatabaseErrors(db.execute(statementQuery, "objects"));
	if (budget === undefined) {
		return rows;
	}
	const bytes = Number(rows[0]?.["ryotqlBytes"] ?? 0);
	if (bytes > budget.remainingBytes) {
		return yield* new RyotQLBadRequest({
			reason: { code: "result-too-large", limitBytes: budget.limitBytes },
		});
	}
	budget.remainingBytes -= bytes;
	return rows.filter((row) => row["ryotqlOrdinal"] !== null);
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

const compileTimeSeriesQuery = (query: TimeSeriesQuery, plan: PlannedScope) => {
	const ctx = rootContext(plan);
	const time = compileExpression(query.output.time.expr, ctx);
	const measure = compileAggregation(query.output.measure.aggregation, ctx, true);
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
	const aggregate = sql`"timeSeriesAggregate" AS (
			SELECT ${timeSeriesBucketStart(bucket, time)} AS "bucketStart", ${measure} AS "value"
			${querySetSql(query, ctx, [range])}
			GROUP BY 1
		)`;
	return withCtes(
		plan,
		sql`
		SELECT
			("timeSeriesGrid"."bucketStart" AT TIME ZONE 'UTC') AS "startAt",
			(("timeSeriesGrid"."bucketStart" + ${step}) AT TIME ZONE 'UTC') AS "endAt",
			COALESCE("timeSeriesAggregate"."value", 0) AS "value"
		FROM generate_series(${gridStart}, ${gridStop}, ${step}) AS "timeSeriesGrid"("bucketStart")
		LEFT JOIN "timeSeriesAggregate" ON "timeSeriesAggregate"."bucketStart" = "timeSeriesGrid"."bucketStart"
		ORDER BY "timeSeriesGrid"."bucketStart"
	`,
		[aggregate],
	);
};

const normalizeValue = (value: unknown, kind: ScalarKind) => {
	if (kind === "number") {
		return Number(value);
	}
	if (kind !== "date") {
		return value;
	}
	if (value instanceof Date) {
		return value.toISOString();
	}
	return typeof value === "string" || typeof value === "number"
		? new Date(value).toISOString()
		: value;
};

const isFieldKind = (value: unknown): value is ScalarKind =>
	value === "boolean" ||
	value === "date" ||
	value === "json" ||
	value === "null" ||
	value === "number" ||
	value === "text";

const reconstructKind = (
	expr: ScalarExpression,
	scope: AliasScope,
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
	include: ExpandedInclude,
	parent: PlannedScope,
): IncludeResult => {
	const scope = childScope(parent, include);
	if (
		!isObjectRecord(raw) ||
		!isUnknownArray(raw["items"]) ||
		typeof raw["hasMore"] !== "boolean"
	) {
		throw new Error(`RyotQL received an invalid include value for '${include.key}'`);
	}
	const items = raw["items"].map((item): RowItem => {
		if (!isUnknownArray(item)) {
			throw new Error(`RyotQL received an invalid include row for '${include.key}'`);
		}
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
				[child.key, reconstructInclude(item[offset + index], child, scope)] as const,
		);
		return Object.fromEntries([...fields, ...nested]);
	});
	return { items, pageInfo: { limit: include.limit, hasMore: raw["hasMore"] } };
};

const aggregationMeasureKind = (
	measure: AggregateMeasure,
	scope: AliasScope,
): undefined | ScalarKind => {
	if (measure.aggregation.function === "minimum" || measure.aggregation.function === "maximum") {
		return scalarExpressionKind(measure.aggregation.expr, scope, kindResolver);
	}
	return "number";
};

const reconstructAggregateItem = (
	row: Readonly<Record<string, unknown>>,
	groups: readonly FieldSelection[],
	measures: readonly AggregateMeasure[],
	scope: AliasScope,
) => {
	const grouped = groups.map((group, index) => {
		const value = row[`g${index}v`];
		const kind = reconstructKind(group.expr, scope, value, row[`g${index}k`]);
		return [group.key, normalizeValue(value, kind)] as const;
	});
	const measured = measures.map((measure, index) => {
		const value = row[`m${index}`];
		if (value === null) {
			return [measure.key, null] as const;
		}
		return [
			measure.key,
			normalizeValue(value, aggregationMeasureKind(measure, scope) ?? "number"),
		] as const;
	});
	const item = Object.fromEntries([...grouped, ...measured]);
	if (!isJsonValue(item)) {
		throw new Error("RyotQL received a non-JSON aggregate value");
	}
	return item;
};

const queryOwnerIdentity = (executionScope: RyotQLExecutionScope, query: ExpandedNamedQuery) =>
	encodeJson({
		scope: executionScope,
		references: pluginIdentityReferences({ queries: { query } })
			.map((reference) => stableStringify(reference))
			.sort(),
	}).pipe(Effect.map(sha256Hex));

const executeAggregateQuery = Effect.fn("executeRyotQLAggregateQuery")(function* (
	executionScope: RyotQLExecutionScope,
	query: AggregateQuery,
	queryName: string,
	db: EffectPgDatabase,
	budget: undefined | RyotQLResultBudget,
) {
	const plan = planQuery(query, executionScope);
	const groups = query.output.groupBy ?? [];
	const orders = groups.length === 0 ? [] : aggregateOrders(query, plan);
	const kinds = orders.map((order) => order.kind);
	const directions = orders.map((order) => order.direction);
	const ownerIdentity = yield* queryOwnerIdentity(executionScope, query);
	const cursor = query.output.after
		? yield* decodeCursor(query.output.after, kinds, directions, ownerIdentity)
		: undefined;
	const rows = yield* executeSql(
		compileAggregateQuery(query, plan, orders, cursor),
		queryName,
		db,
		budget,
	);
	if (groups.length === 0) {
		const items = rows.map((row) =>
			reconstructAggregateItem(row, groups, query.output.measures, plan),
		);
		return { items, type: "aggregate" } satisfies AggregateResult;
	}
	const limit = query.output.limit;
	if (limit === undefined) {
		throw new Error("RyotQL grouped aggregate is missing a limit after validation");
	}
	const hasMore = rows.length > limit;
	const returnedRows = rows.slice(0, limit);
	const items = returnedRows.map((row) =>
		reconstructAggregateItem(row, groups, query.output.measures, plan),
	);
	const resumable = groups.every((_, index) =>
		orders.some((order) => order.column === `g${index}v`),
	);
	const last = hasMore && resumable ? returnedRows.at(-1) : undefined;
	const nextCursor = last
		? yield* encodeCursor(
				orders.map((order): CursorValue => {
					const value = last[order.column];
					if (value === null || value === undefined) {
						return { value: null, kind: "null" };
					}
					const cursorValue = makeCursorValue(order.kind, normalizeValue(value, order.kind));
					if (!cursorValue) {
						throw new Error("RyotQL received an invalid aggregate order value");
					}
					return cursorValue;
				}),
				directions,
				ownerIdentity,
			)
		: null;
	return {
		items,
		type: "aggregate",
		pageInfo: { limit, hasMore, nextCursor },
	} satisfies AggregateResult;
});

const executeTimeSeriesQuery = Effect.fn("executeRyotQLTimeSeriesQuery")(function* (
	executionScope: RyotQLExecutionScope,
	query: TimeSeriesQuery,
	queryName: string,
	db: EffectPgDatabase,
	budget: undefined | RyotQLResultBudget,
) {
	const raw = yield* executeSql(
		compileTimeSeriesQuery(query, planQuery(query, executionScope)),
		queryName,
		db,
		budget,
	);
	const buckets = raw.map((row) => {
		const startAt = normalizeValue(row["startAt"], "date");
		const endAt = normalizeValue(row["endAt"], "date");
		if (typeof startAt !== "string" || typeof endAt !== "string") {
			throw new Error("RyotQL received an invalid time-series bucket boundary");
		}
		return { endAt, startAt, value: Number(row["value"]) };
	});
	return { buckets, type: "timeSeries" } satisfies TimeSeriesResult;
});

export const executeNamedQuery = Effect.fn("executeRyotQLNamedQuery")(function* (
	executionScope: RyotQLExecutionScope,
	query: ExpandedNamedQuery,
	queryName: string,
	db: EffectPgDatabase,
	budget?: RyotQLResultBudget,
) {
	if (query.output.type === "aggregate") {
		return yield* executeAggregateQuery(
			executionScope,
			{ ...query, output: query.output },
			queryName,
			db,
			budget,
		);
	}
	if (query.output.type === "timeSeries") {
		return yield* executeTimeSeriesQuery(
			executionScope,
			{ ...query, output: query.output },
			queryName,
			db,
			budget,
		);
	}
	const rowsQuery = { ...query, output: query.output };
	const plan = planQuery(rowsQuery, executionScope);
	const orders = appendPrimaryKeyOrders(rowsQuery, plan, rowsQuery.output.orderBy);
	const orderKinds = orders.map((order) => expressionKind(order.expr, plan));
	const orderDirections = orders.map((order) => order.direction);
	const ownerIdentity = yield* queryOwnerIdentity(executionScope, rowsQuery);
	const cursor = rowsQuery.output.pagination.after
		? yield* decodeCursor(
				rowsQuery.output.pagination.after,
				orderKinds,
				orderDirections,
				ownerIdentity,
			)
		: undefined;
	const rows = yield* executeSql(
		compileRowsQuery(rowsQuery, plan, orders, cursor),
		queryName,
		db,
		budget,
	);
	const { limit } = rowsQuery.output.pagination;
	const hasMore = rows.length > limit;
	const returnedRows = rows.slice(0, limit);
	const items = returnedRows.map((row) => {
		const fields = rowsQuery.output.fields.map((field, index) => {
			const value = row[`f${index}v`];
			const kind = reconstructKind(field.expr, plan, value, row[`f${index}k`]);
			return [field.key, normalizeValue(value, kind)] as const;
		});
		const include = (rowsQuery.output.include ?? []).map(
			(entry, index) => [entry.key, reconstructInclude(row[`i${index}`], entry, plan)] as const,
		);
		return Object.fromEntries([...fields, ...include]);
	});
	const last = hasMore ? returnedRows.at(-1) : undefined;
	const nextCursor = last
		? yield* encodeCursor(
				orderKinds.map((kind, index): CursorValue => {
					const value = last[`o${index}`];
					if (value === null) {
						return { value: null, kind: "null" };
					}
					const cursorValue = makeCursorValue(
						kind,
						kind === "date" ? value : normalizeValue(value, kind),
					);
					if (!cursorValue) {
						throw new Error("RyotQL received an invalid order value");
					}
					return cursorValue;
				}),
				orderDirections,
				ownerIdentity,
			)
		: null;

	return { items, type: "rows", pageInfo: { limit, hasMore, nextCursor } } satisfies RowsResult;
});
