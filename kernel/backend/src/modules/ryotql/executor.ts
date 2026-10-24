import { RyotQLBadRequest } from "@ryot-app/contract/modules/ryotql/contract";
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
	getCatalogTable,
	jsonElementsTable,
	resolveCatalogField,
	type RyotQLExecutionScope,
} from "./catalog";
import { type KindResolver, scalarExpressionKind, type ScalarKind } from "./expression-kind";
import type { ExpandedInclude, ExpandedNamedQuery, ExpandedRowsOutput } from "./validator";

type SqlFragment = ReturnType<typeof sql>;
type AggregateQuery = NamedQuery & { readonly output: AggregateOutput };
type TimeSeriesQuery = NamedQuery & { readonly output: TimeSeriesOutput };
type Order = { readonly expr: ScalarExpression; readonly direction: "asc" | "desc" };
type QuerySet = Include | CorrelatedQuerySet | Pick<NamedQuery, "from" | "joins" | "where">;
type RowsQuery = Omit<ExpandedNamedQuery, "output"> & { readonly output: ExpandedRowsOutput };
type CompileTable = {
	readonly alias: string;
	readonly fields: Set<string>;
	readonly table: CatalogTable;
	readonly joinedNullable: boolean;
	readonly executionScope: RyotQLExecutionScope;
	computedKeys?: ReadonlyMap<string, SqlFragment>;
};
type CursorValue =
	| { readonly value: null; readonly kind: "null" }
	| { readonly kind: "date"; readonly value: string }
	| { readonly kind: "text"; readonly value: string }
	| { readonly kind: "json"; readonly value: unknown }
	| { readonly value: number; readonly kind: "number" }
	| { readonly value: boolean; readonly kind: "boolean" };
class CompileScope extends Map<string, CompileTable> {
	fuseAggregates = false;
	readonly relations: Map<string, SqlFragment>;
	readonly bindings = new Map<
		string,
		{ readonly value: SqlFragment; readonly source: SqlFragment }
	>();
	readonly aggregates = new Map<
		string,
		{
			readonly alias: string;
			readonly scope: CompileScope;
			readonly query: CorrelatedQuerySet;
			readonly measures: Map<string, { readonly alias: string; readonly value: SqlFragment }>;
		}
	>();

	constructor(ancestors?: CompileScope) {
		super(ancestors);
		this.relations = ancestors?.relations ?? new Map<string, SqlFragment>();
	}
}

const CURSOR_VERSION = 1;
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

const identifier = (value: string): SqlFragment => sql`${sql.identifier(value)}`;

const qualifiedIdentifier = (table: string, column: string): SqlFragment =>
	sql`${sql.identifier(table)}.${sql.identifier(column)}`;

let jsonElementAliasCounter = 0;
const jsonElementAliasStack: string[] = [];

const withJsonElementAlias = <A>(alias: string, compile: () => A): A => {
	jsonElementAliasStack.push(alias);
	try {
		return compile();
	} finally {
		jsonElementAliasStack.pop();
	}
};

const requireJsonElementAlias = () => {
	const alias = jsonElementAliasStack.at(-1);
	if (!alias) {
		throw new Error("RyotQL compiler received a JSON element outside an array operator");
	}
	return alias;
};

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
	const scope = new CompileScope(ancestors);
	scope.set(query.from.alias, {
		executionScope,
		fields: new Set(),
		joinedNullable: false,
		alias: `kind${ancestors.size}_t0`,
		table: requireTable(query.from.table),
	});
	(query.joins ?? []).forEach((join, index) => {
		const alias = `kind${ancestors.size}_t${index + 1}`;
		scope.set(
			join.type === "jsonElements" ? join.alias : join.table.alias,
			join.type === "jsonElements"
				? {
						alias,
						executionScope,
						fields: new Set(),
						table: jsonElementsTable,
						joinedNullable: join.mode === "left",
					}
				: {
						alias,
						executionScope,
						fields: new Set(),
						joinedNullable: true,
						table: requireTable(join.table.table),
					},
		);
	});
	return scope;
};

const resolveCompileField = (compileTable: CompileTable, field: string) =>
	resolveCatalogField(compileTable.table, field, compileTable.executionScope);

const kindResolver: KindResolver<CompileScope> = {
	correlated: (query, scope) => expressionScope(query, scope),
	column: (expr, scope) =>
		resolveCompileField(requireCompileTable(scope, expr.tableAlias), expr.field)?.kind,
};

const expressionKind = (expr: ScalarExpression, scope: CompileScope): ScalarKind => {
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

const inlineCastOperand = (expr: ScalarExpression, scope: CompileScope): boolean => {
	if (expr.type === "literal" || expr.type === "jsonElement") {
		return true;
	}
	if (expr.type === "jsonPath") {
		return inlineCastOperand(expr.expr, scope);
	}
	return (
		expr.type === "column" &&
		resolveCompileField(requireCompileTable(scope, expr.tableAlias), expr.field)?.column !==
			undefined
	);
};

const bindCastOperand = (
	expr: ScalarExpression,
	scope: CompileScope,
	operand: SqlFragment,
	cast: (value: SqlFragment) => SqlFragment,
) =>
	inlineCastOperand(expr, scope)
		? cast(operand)
		: // Subquery operands stay bound; scalar columns must remain visible to join planning.
			sql`(SELECT ${cast(sql.raw("cast_operand.value"))} FROM (SELECT ${operand} AS value OFFSET 0) cast_operand)`;

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

const compileTypedJsonPathCast = (
	expr: Extract<ScalarExpression, { type: "cast" }>,
	scope: CompileScope,
): undefined | SqlFragment => {
	if (
		(expr.target !== "text" && expr.target !== "boolean" && expr.target !== "number") ||
		expr.expr.type !== "jsonPath" ||
		expr.expr.expr.type !== "column" ||
		expr.expr.path.some(
			(segment) =>
				typeof segment !== "string" ||
				!segment.isWellFormed() ||
				segment.includes("\0") ||
				/^\s*[+-]?\d+\s*$/.test(segment),
		)
	) {
		return undefined;
	}
	const operand = expr.expr;
	const column = expr.expr.expr;
	const table = requireCompileTable(scope, column.tableAlias);
	const field = resolveCompileField(table, column.field);
	if (
		field?.kind !== "json" ||
		field.column === undefined ||
		table.computedKeys?.has(stableStringify(expr)) ||
		(scope.bindings.size > 0 &&
			(scope.bindings.has(stableStringify(operand)) || scope.bindings.has(stableStringify(column))))
	) {
		return undefined;
	}
	const kind = expr.target === "text" ? "string" : expr.target;
	const path = `strict $${operand.path.map((segment) => `.${JSON.stringify(segment)}`).join("")} ? (@.type() == "${kind}")${expr.target === "number" ? ".double()" : ""}`;
	const value = sql`(jsonb_path_query_first(${compileExpression(column, scope)}, ${path}::jsonpath, '{}'::jsonb, true) #>> '{}')`;
	return expr.target === "text" ? value : sql`${value}::${sql.raw(castSqlType(expr.target))}`;
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
			compileCast({ type: "cast", expr: first.select, target: expr.target }, childScope),
		);
	}
	if (expr.expr.type === "coalesce" && sourceKind === "json") {
		const branchScope = new CompileScope(scope);
		const branches = expr.expr.values.map(
			(value) =>
				sql`WHEN ${compileJsonValue(value, branchScope)} IS NOT NULL THEN ${compileCast(
					{ expr: value, type: "cast", target: expr.target },
					branchScope,
				)}`,
		);
		return sql`CASE ${sql.join(branches, sql` `)} ELSE ${typedNull(expr.target)} END`;
	}
	const typedPath = compileTypedJsonPathCast(expr, scope);
	if (typedPath) {
		return typedPath;
	}
	const source = compileExpression(expr.expr, scope);
	if (sourceKind === expr.target) {
		return source;
	}
	if (sourceKind === "json") {
		if (expr.target === "text") {
			return bindCastOperand(
				expr.expr,
				scope,
				compileJsonValue(expr.expr, scope),
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
		return bindCastOperand(expr.expr, scope, compileJsonValue(expr.expr, scope), (value) => {
			const text = sql`(${value} #>> '{}')`;
			const valid = expr.target === "boolean" ? sql`true` : safeInputValid(text, expr.target);
			return sql`(CASE WHEN jsonb_typeof(${value}) = ${jsonType} AND ${valid} THEN ${text} END)::${sql.raw(sqlType)}`;
		});
	}
	if (sourceKind === "text" && expr.target !== "text") {
		const sqlType = castSqlType(expr.target);
		return bindCastOperand(
			expr.expr,
			scope,
			source,
			(value) =>
				sql`(CASE WHEN ${safeInputValid(value, expr.target)} THEN ${value} END)::${sql.raw(sqlType)}`,
		);
	}
	if (expr.target === "text") {
		return compileTextValue(expr.expr, scope);
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
	const branchScope = new CompileScope(scope);
	const compileBranch = (branch: ScalarExpression) =>
		kind === "json"
			? compileJsonValue(branch, branchScope)
			: compileExpression(branch, branchScope);
	return sql`CASE WHEN ${compilePredicate(expr.condition, scope)} THEN ${compileBranch(expr.whenTrue)} ELSE ${compileBranch(expr.whenFalse)} END`;
};

const compileUnary = (
	expr: Extract<ScalarExpression, { type: "floor" | "round" | "integer" }>,
	scope: CompileScope,
) => {
	const value = compileCast({ type: "cast", expr: expr.expr, target: "number" }, scope);
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
	const left = compileCast({ type: "cast", expr: expr.left, target: "number" }, scope);
	const right = compileCast({ type: "cast", expr: expr.right, target: "number" }, scope);
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
	const bound = scope.bindings.size > 0 ? scope.bindings.get(stableStringify(expr)) : undefined;
	if (bound) {
		return bound.value;
	}
	const keyColumn = sourceJoinKeyColumn(expr);
	const computed = keyColumn
		? requireCompileTable(scope, keyColumn.tableAlias).computedKeys?.get(stableStringify(expr))
		: undefined;
	if (computed) {
		return computed;
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
		return compileCast(expr, scope);
	}
	if (expr.type === "currentDate") {
		return sql`(date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')`;
	}
	if (expr.type === "dateBucket") {
		return sql`date_trunc(${expr.bucket}, ${compileExpression(expr.expr, scope)}, ${expr.timeZone})`;
	}
	if (expr.type === "localDate") {
		const value =
			expressionKind(expr.expr, scope) === "null"
				? typedNull("date")
				: compileExpression(expr.expr, scope);
		return sql`to_char(${value} AT TIME ZONE ${expr.timeZone}, 'YYYY-MM-DD')`;
	}
	if (expr.type === "localHour") {
		return sql`extract(hour from (${compileExpression(expr.expr, scope)} AT TIME ZONE ${expr.timeZone}))`;
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
	if (expr.type === "jsonElement") {
		return sql.raw(`${requireJsonElementAlias()}.elem`);
	}
	if (expr.type === "jsonExists") {
		return compileJsonArrayExists(expr, scope);
	}
	if (expr.type === "jsonFirst") {
		return compileJsonArrayFirst(expr, scope);
	}
	if (expr.type === "jsonCount") {
		return compileJsonArrayCount(expr, scope);
	}
	if (expr.type === "coalesce") {
		const kind = expressionKind(expr, scope);
		const branchScope = new CompileScope(scope);
		return kind === "json"
			? sql`COALESCE(${sql.join(
					expr.values.map((value) => compileJsonValue(value, branchScope)),
					sql`, `,
				)})`
			: sql`COALESCE(${sql.join(
					expr.values.map((value) => compileExpression(value, branchScope)),
					sql`, `,
				)})`;
	}
	const compileTable = requireCompileTable(scope, expr.tableAlias);
	compileTable.fields.add(expr.field);
	const field = resolveCompileField(compileTable, expr.field);
	if (!field) {
		throw new Error(`RyotQL compiler received unknown field '${expr.field}'`);
	}
	const execution = scopeExecution(scope);
	return field.resolve({
		sqlAlias: compileTable.alias,
		language: scopeLanguage(scope),
		userId: execution.type === "user" ? execution.userId : null,
	});
};

const expressionNullable = (expr: ScalarExpression, scope: CompileScope): boolean => {
	if (expr.type === "literal") {
		return expr.value === null;
	}
	if (expr.type === "localDate") {
		return expressionNullable(expr.expr, scope);
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
		const table = requireCompileTable(scope, expr.tableAlias);
		const field = resolveCompileField(table, expr.field);
		return (
			table.joinedNullable ||
			(!table.table.primaryKey.includes(expr.field) && (field?.nullable ?? true))
		);
	}
	return true;
};

const likePattern = (
	operand: ScalarExpression,
	scope: CompileScope,
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
	const escaped = sql`replace(replace(replace(${compileExpression(operand, scope)}, ${"\\"}, ${"\\\\"}), ${"%"}, ${"\\%"}), ${"_"}, ${"\\_"})`;
	return sql`(${leading} || ${escaped} || ${"%"})`;
};

const compilePredicate = (
	predicate: Predicate,
	scope: CompileScope,
	total = false,
): SqlFragment => {
	if (predicate.type === "exists") {
		return compileExists(predicate, scope);
	}
	if (predicate.type === "jsonExists") {
		return compileJsonArrayExists(predicate, scope);
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
			const jsonComparison = sql`${compileJsonValue(predicate.left, scope)} ${operator} ${compileJsonValue(predicate.right, scope)}`;
			return total ? sql`COALESCE(${jsonComparison}, false)` : jsonComparison;
		}
		const comparison = sql`${compileExpression(predicate.left, scope)} ${operator} ${compileExpression(predicate.right, scope)}`;
		return total &&
			(expressionNullable(predicate.left, scope) || expressionNullable(predicate.right, scope))
			? sql`COALESCE(${comparison}, false)`
			: comparison;
	}
	if (predicate.type === "and" || predicate.type === "or") {
		if (predicate.predicates.length === 0) {
			return predicate.type === "and" ? sql`true` : sql`false`;
		}
		const separator = predicate.type === "and" ? sql` AND ` : sql` OR `;
		return sql`(${sql.join(
			predicate.predicates.map((value) => compilePredicate(value, scope, total)),
			separator,
		)})`;
	}
	if (predicate.type === "not") {
		return sql`(NOT ${compilePredicate(predicate.predicate, scope, true)})`;
	}
	if (predicate.type === "isNull" || predicate.type === "isNotNull") {
		const operator = predicate.type === "isNull" ? sql`IS NULL` : sql`IS NOT NULL`;
		return sql`(${compileExpression(predicate.expr, scope)} ${operator})`;
	}
	if (predicate.type === "contains") {
		if (expressionKind(predicate.left, scope) === "json") {
			const containment = sql`${compileJsonValue(predicate.left, scope)} @> ${compileJsonValue(predicate.right, scope)}`;
			return total ? sql`COALESCE(${containment}, false)` : containment;
		}
		const match = sql`${compileExpression(predicate.left, scope)} COLLATE "C" ILIKE ${likePattern(predicate.right, scope, "contains")}`;
		return total ? sql`COALESCE(${match}, false)` : match;
	}
	if (predicate.type === "startsWith") {
		const match = sql`${compileExpression(predicate.left, scope)} COLLATE "C" ILIKE ${likePattern(predicate.right, scope, "startsWith")}`;
		return total ? sql`COALESCE(${match}, false)` : match;
	}
	const membership = predicate satisfies Extract<Predicate, { type: "in" }>;
	if (membership.values.length === 0) {
		return sql`false`;
	}
	const kind = expressionKind(membership.expr, scope);
	if (kind === "json") {
		const jsonMembership = sql`${compileJsonValue(membership.expr, scope)} IN (${sql.join(
			membership.values.map((value) => compileJsonValue(value, scope)),
			sql`, `,
		)})`;
		return total ? sql`COALESCE(${jsonMembership}, false)` : jsonMembership;
	}
	const comparison = sql`${compileExpression(membership.expr, scope)} IN (${sql.join(
		membership.values.map((value) => compileExpression(value, scope)),
		sql`, `,
	)})`;
	return total &&
		(expressionNullable(membership.expr, scope) ||
			membership.values.some((value) => expressionNullable(value, scope)))
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
		const branchScope = new CompileScope(scope);
		const cases = expr.values.map((value) => {
			const json = compileJsonValue(value, branchScope);
			return sql`WHEN ${json} IS NOT NULL THEN ${outputKind(value, branchScope)}`;
		});
		return sql`CASE ${sql.join(cases, sql` `)} ELSE 'null' END`;
	}
	if (expr.type === "first") {
		return sql`COALESCE(${compileFirst(expr, scope, (childScope) => outputKind(expr.select, childScope))}, 'null')`;
	}
	if (expr.type === "jsonFirst") {
		return sql`COALESCE(${compileJsonArrayFirst(expr, scope, () => outputKind(expr.select, scope))}, 'null')`;
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
	ancestors?: CompileScope,
) => {
	const root = requireTable(query.from.table);
	const scope = new CompileScope(ancestors);
	scope.fuseAggregates = true;
	scope.set(query.from.alias, {
		table: root,
		executionScope,
		fields: new Set(),
		alias: `${prefix}t0`,
		joinedNullable: false,
	});
	(query.joins ?? []).forEach((join, index) => {
		const alias = `${prefix}t${index + 1}`;
		if (join.type === "jsonElements") {
			scope.set(join.alias, {
				alias,
				executionScope,
				fields: new Set(),
				table: jsonElementsTable,
				joinedNullable: join.mode === "left",
			});
			return;
		}
		scope.set(join.table.alias, {
			alias,
			executionScope,
			fields: new Set(),
			joinedNullable: join.type === "left",
			table: requireTable(join.table.table),
		});
	});
	return scope;
};

const catalogSource = (table: CompileTable, scope: CompileScope) => {
	const source = authorizedTable(table.table, table.executionScope);
	return (
		table.table.source?.({
			source,
			fields: table.fields,
			relations: scope.relations,
			userId: table.executionScope.type === "user" ? table.executionScope.userId : null,
		}) ?? source
	);
};

const withRelations = (scope: CompileScope, query: SqlFragment, extra: SqlFragment[] = []) => {
	const relations = [
		...[...scope.relations].map(
			([name, source]) => sql`${identifier(name)} AS MATERIALIZED (${source})`,
		),
		...extra,
	];
	return relations.length > 0 ? sql`WITH ${sql.join(relations, sql`, `)} ${query}` : query;
};

const predicateConjuncts = (predicate: Predicate): Predicate[] =>
	predicate.type === "and" ? predicate.predicates.flatMap(predicateConjuncts) : [predicate];

const sourceFieldColumns = (table: CompileTable, field: string) => {
	const resolved = resolveCompileField(table, field);
	return resolved?.column === undefined ? resolved?.sourceColumns : [resolved.column];
};

const sourceLocalExpression = (
	expr: ScalarExpression,
	alias: string | undefined,
	scope: CompileScope,
): boolean => {
	if (expr.type === "literal" || expr.type === "pluginId" || expr.type === "currentDate") {
		return true;
	}
	if (expr.type === "cast" || expr.type === "jsonPath") {
		return sourceLocalExpression(expr.expr, alias, scope);
	}
	return (
		expr.type === "column" &&
		expr.tableAlias === alias &&
		sourceFieldColumns(requireCompileTable(scope, alias), expr.field) !== undefined
	);
};

const sourceLocalPredicate = (
	predicate: Predicate,
	alias: string,
	scope: CompileScope,
): boolean => {
	if (predicate.type === "and" || predicate.type === "or") {
		return predicate.predicates.every((value) => sourceLocalPredicate(value, alias, scope));
	}
	if (predicate.type === "not") {
		return sourceLocalPredicate(predicate.predicate, alias, scope);
	}
	if (predicate.type === "isNull" || predicate.type === "isNotNull") {
		return sourceLocalExpression(predicate.expr, alias, scope);
	}
	if (predicate.type === "in") {
		return (
			sourceLocalExpression(predicate.expr, alias, scope) &&
			predicate.values.every((value) => sourceLocalExpression(value, alias, scope))
		);
	}
	return (
		(predicate.type === "comparison" ||
			predicate.type === "contains" ||
			predicate.type === "startsWith") &&
		sourceLocalExpression(predicate.left, alias, scope) &&
		sourceLocalExpression(predicate.right, alias, scope)
	);
};

const sourceDateBound = (predicate: Predicate, alias: string, scope: CompileScope) => {
	if (
		predicate.type !== "comparison" ||
		predicate.operator === "eq" ||
		predicate.operator === "neq"
	) {
		return undefined;
	}
	for (const { value, bound, reversed } of [
		{ reversed: false, value: predicate.left, bound: predicate.right },
		{ reversed: true, bound: predicate.left, value: predicate.right },
	]) {
		if (
			sourceLocalExpression(value, alias, scope) &&
			!sourceLocalExpression(value, undefined, scope) &&
			sourceLocalExpression(bound, undefined, scope) &&
			expressionKind(value, scope) === "date" &&
			expressionKind(bound, scope) === "date"
		) {
			return {
				key: stableStringify(value),
				lower: (predicate.operator === "gt" || predicate.operator === "gte") !== reversed,
			};
		}
	}
	return undefined;
};

const sourceJoinKeyColumn = (expr: ScalarExpression) =>
	expr.type === "cast" &&
	expr.target !== "json" &&
	expr.expr.type === "jsonPath" &&
	expr.expr.expr.type === "column"
		? expr.expr.expr
		: undefined;

const sourceJoinKeys = (expr: ScalarExpression): ScalarExpression[] => {
	if (expr.type === "coalesce") {
		return expr.values.flatMap(sourceJoinKeys);
	}
	return sourceJoinKeyColumn(expr) ? [expr] : [];
};

type QueryValue = Predicate | ScalarExpression;

const queryValueChildren = (value: QueryValue): undefined | readonly QueryValue[] => {
	if ("query" in value || value.type === "conditional") {
		return undefined;
	}
	if (value.type === "comparison" || value.type === "contains" || value.type === "startsWith") {
		return [value.left, value.right];
	}
	if (value.type === "and" || value.type === "or") {
		return value.predicates;
	}
	if (value.type === "not") {
		return [value.predicate];
	}
	if (value.type === "in") {
		return [value.expr, ...value.values];
	}
	if ("expr" in value) {
		return [value.expr];
	}
	if (value.type === "coalesce" || value.type === "concat") {
		return value.values;
	}
	if (value.type === "arithmetic") {
		return [value.left, value.right];
	}
	if (value.type === "jsonExists" || value.type === "jsonFirst" || value.type === "jsonCount") {
		return [
			value.array,
			...(value.where ? [value.where] : []),
			...(value.type === "jsonFirst"
				? [value.select, ...value.orderBy.map((order) => order.expr)]
				: []),
		];
	}
	return [];
};

const materializeAggregateJoinKeys = (query: QuerySet, scope: CompileScope) => {
	const joins = query.joins ?? [];
	if (joins.some((join) => join.type !== "inner")) {
		return undefined;
	}
	const references = [
		query.from,
		...joins.flatMap((join) => (join.type === "inner" ? [join.table] : [])),
	];
	const aliases = new Set(references.map((reference) => reference.alias));
	const predicates = [
		...(query.where ? predicateConjuncts(query.where) : []),
		...joins.flatMap((join) => (join.type === "inner" ? predicateConjuncts(join.on) : [])),
	];
	const nodes: QueryValue[] = [];
	const collect = (value: QueryValue): boolean => {
		const children = queryValueChildren(value);
		nodes.push(value);
		return children?.every(collect) ?? false;
	};
	if (
		!predicates.every(collect) ||
		!nodes.some((node) => node.type === "column" && !aliases.has(node.tableAlias)) ||
		nodes.some(
			(node) =>
				node.type === "column" && requireCompileTable(scope, node.tableAlias).joinedNullable,
		) ||
		nodes.some(
			(node) =>
				node.type === "comparison" &&
				node.operator === "eq" &&
				node.left.type === "column" &&
				node.right.type === "column" &&
				aliases.has(node.left.tableAlias) !== aliases.has(node.right.tableAlias) &&
				[node.left, node.right].every(
					(column) =>
						resolveCompileField(requireCompileTable(scope, column.tableAlias), column.field)
							?.column !== undefined,
				),
		)
	) {
		return undefined;
	}
	for (const reference of references) {
		const bounds = nodes.flatMap((node) => {
			const bound =
				node.type === "comparison" ? sourceDateBound(node, reference.alias, scope) : undefined;
			return bound ? [bound] : [];
		});
		if (
			bounds.some((bound) =>
				bounds.some((other) => bound.key === other.key && bound.lower !== other.lower),
			)
		) {
			return undefined;
		}
	}
	for (const reference of references) {
		const table = requireCompileTable(scope, reference.alias);
		const keys = new Map<string, ScalarExpression>();
		for (const join of joins) {
			if (join.type !== "inner") {
				continue;
			}
			for (const predicate of predicateConjuncts(join.on)) {
				if (predicate.type !== "comparison" || predicate.operator !== "eq") {
					continue;
				}
				for (const [operand, other] of [
					[predicate.left, predicate.right],
					[predicate.right, predicate.left],
				] as const) {
					if (
						!references.some(
							(otherSource) =>
								otherSource.alias !== reference.alias &&
								!sourceLocalExpression(other, undefined, scope) &&
								sourceLocalExpression(other, otherSource.alias, scope),
						)
					) {
						continue;
					}
					for (const expr of sourceJoinKeys(operand)) {
						const column = sourceJoinKeyColumn(expr);
						const field = column ? resolveCompileField(table, column.field) : undefined;
						if (column?.tableAlias === reference.alias && field?.kind === "json" && field.column) {
							keys.set(stableStringify(expr), expr);
						}
					}
				}
			}
		}
		if (keys.size === 0) {
			continue;
		}
		const fields = new Set(table.fields);
		const required = (value: QueryValue): void => {
			if (value.type === "cast" && keys.has(stableStringify(value))) {
				return;
			}
			if (value.type === "column" && value.tableAlias === reference.alias) {
				fields.add(value.field);
			}
			queryValueChildren(value)?.forEach(required);
		};
		predicates.forEach(required);
		if ([...keys.values()].some((expr) => fields.has(sourceJoinKeyColumn(expr)?.field ?? ""))) {
			continue;
		}
		const columns = new Set<string>();
		if (
			![...fields].every((field) => {
				const dependencies = sourceFieldColumns(table, field);
				dependencies?.forEach((column) => columns.add(column));
				return dependencies !== undefined;
			}) ||
			[...keys.values()].some((expr) => {
				const column = sourceJoinKeyColumn(expr);
				const payload = column ? resolveCompileField(table, column.field)?.column : undefined;
				return payload !== undefined && columns.has(payload);
			})
		) {
			continue;
		}
		const physicalColumns = [...columns].map((column) => qualifiedIdentifier(table.alias, column));
		const projectedKeys = [...keys].map(([key, expr], index) => {
			let name = `joinKey${index}`;
			while (columns.has(name)) {
				name += "_";
			}
			columns.add(name);
			return { key, name, value: compileExpression(expr, scope) };
		});
		const local = predicates
			.filter((predicate) => sourceLocalPredicate(predicate, reference.alias, scope))
			.map((predicate) => compilePredicate(predicate, scope));
		fields.forEach((field) => table.fields.add(field));
		const source = catalogSource(table, scope);
		const name = `aggregateSource${scope.relations.size}`;
		scope.relations.set(
			name,
			sql`SELECT ${sql.join(
				[
					...physicalColumns,
					...projectedKeys.map((key) => sql`${key.value} AS ${identifier(key.name)}`),
				],
				sql`, `,
			)} FROM ${source} ${identifier(table.alias)} ${local.length > 0 ? sql`WHERE ${sql.join(local, sql` AND `)}` : sql``}`,
		);
		table.computedKeys = new Map(
			projectedKeys.map((key) => [key.key, qualifiedIdentifier(table.alias, key.name)]),
		);
		return { table, source: identifier(name), predicates: new Set<Predicate>() };
	}
	return undefined;
};

const materializeAggregateRange = (
	query: QuerySet,
	scope: CompileScope,
	predicates: ReadonlyMap<Predicate, SqlFragment>,
) => {
	const joins = query.joins ?? [];
	if (joins.some((join) => join.type !== "inner")) {
		return undefined;
	}
	const references = [
		query.from,
		...joins.flatMap((join) => (join.type === "inner" ? [join.table] : [])),
	];
	for (const reference of references) {
		const local = [...predicates].filter(([predicate]) =>
			sourceLocalPredicate(predicate, reference.alias, scope),
		);
		const bounds = local.flatMap(([predicate]) => {
			const bound = sourceDateBound(predicate, reference.alias, scope);
			return bound ? [bound] : [];
		});
		if (
			!bounds.some((bound) =>
				bounds.some((other) => bound.key === other.key && bound.lower !== other.lower),
			)
		) {
			continue;
		}
		const table = requireCompileTable(scope, reference.alias);
		const columns = new Set<string>();
		let physical = true;
		for (const field of table.fields) {
			const dependencies = sourceFieldColumns(table, field);
			if (dependencies === undefined) {
				physical = false;
				break;
			}
			for (const column of dependencies) {
				columns.add(column);
			}
		}
		if (!physical) {
			continue;
		}
		const source = catalogSource(table, scope);
		const name = `aggregateSource${scope.relations.size}`;
		scope.relations.set(
			name,
			sql`SELECT ${sql.join(
				[...columns].map((column) => qualifiedIdentifier(table.alias, column)),
				sql`, `,
			)} FROM ${source} ${identifier(table.alias)} WHERE ${sql.join(
				local.map(([, value]) => value),
				sql` AND `,
			)}`,
		);
		return {
			table,
			source: identifier(name),
			predicates: new Set(local.map(([predicate]) => predicate)),
		};
	}
	return undefined;
};

const querySetSql = (
	query: QuerySet,
	scope: CompileScope,
	additionalConditions: readonly SqlFragment[] = [],
	rootSource?: SqlFragment,
	materializeRange = false,
): SqlFragment => {
	const root = requireCompileTable(scope, query.from.alias);
	const keyed = materializeRange ? materializeAggregateJoinKeys(query, scope) : undefined;
	const joinScope = new CompileScope(scope);
	const predicates = new Map<Predicate, SqlFragment>();
	const compileCondition = (predicate: Predicate, conditionScope: CompileScope) => {
		const conjuncts = materializeRange ? predicateConjuncts(predicate) : [predicate];
		for (const conjunct of conjuncts) {
			predicates.set(conjunct, compilePredicate(conjunct, conditionScope));
		}
		return conjuncts;
	};
	const joinConditions = (query.joins ?? []).map((join) =>
		join.type === "jsonElements"
			? compileExpression(join.expr, joinScope)
			: compileCondition(join.on, joinScope),
	);
	const where = query.where ? compileCondition(query.where, scope) : [];
	const aggregates = [...scope.aggregates.values()].map((group) => {
		const source = querySetSql(group.query, group.scope, [], undefined, true);
		const measures = [...group.measures.values()].map(
			({ alias, value }) => sql`${value} AS ${identifier(alias)}`,
		);
		return sql`CROSS JOIN LATERAL (SELECT ${sql.join(measures, sql`, `)} ${source}) ${identifier(group.alias)}`;
	});
	const materialized =
		keyed ?? (materializeRange ? materializeAggregateRange(query, scope, predicates) : undefined);
	const conditionSql = (conjuncts: readonly Predicate[]) => {
		const values = conjuncts.flatMap((predicate) => {
			const value = predicates.get(predicate);
			return value && !materialized?.predicates.has(predicate) ? [value] : [];
		});
		return values.length > 0 ? sql`(${sql.join(values, sql` AND `)})` : sql`true`;
	};
	const joins = (query.joins ?? []).map((join, index) => {
		const condition = joinConditions[index];
		if (join.type === "jsonElements") {
			const elements = requireCompileTable(scope, join.alias);
			const array = condition;
			const source = sql`jsonb_array_elements(CASE WHEN jsonb_typeof(${array}) = 'array' THEN ${array} ELSE '[]'::jsonb END) WITH ORDINALITY AS ${sql.raw(elements.alias)}(${identifier("value")}, ${identifier("ordinal")})`;
			return join.mode === "inner"
				? sql`CROSS JOIN LATERAL ${source}`
				: sql`LEFT JOIN LATERAL ${source} ON true`;
		}
		const joined = requireCompileTable(scope, join.table.alias);
		const joinType = join.type === "inner" ? sql`INNER JOIN` : sql`LEFT JOIN`;
		const source =
			materialized?.table === joined ? materialized.source : catalogSource(joined, scope);
		if (!Array.isArray(condition)) {
			throw new Error("RyotQL compiler received a table join without predicates");
		}
		return sql`${joinType} ${source} ${sql.raw(joined.alias)} ON ${conditionSql(condition)}`;
	});
	const conditions = [...(query.where ? [conditionSql(where)] : []), ...additionalConditions];
	return sql`
		FROM ${rootSource ?? (materialized?.table === root ? materialized.source : catalogSource(root, scope))} ${sql.raw(root.alias)}
		${sql.join(joins, sql` `)}
		${sql.join(aggregates, sql` `)}
		${sql.join(
			[...scope.bindings.values()].map(({ source }) => source),
			sql` `,
		)}
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

const appendPrimaryKeyOrders = (query: QuerySet, requested: readonly Order[]): Order[] => {
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
		].flatMap((reference) => keyOrders(reference.alias, requireTable(reference.table))),
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
	Buffer.from(encodeJson({ values, directions, ownerIdentity, version: CURSOR_VERSION })).toString(
		"base64url",
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
	return sql`EXISTS (SELECT 1 ${querySetSql(expr.query, scope)})`;
};

const compileFirst = (
	expr: Extract<ScalarExpression, { type: "first" }>,
	ancestors: CompileScope,
	select: (scope: CompileScope) => SqlFragment,
) => {
	const scope = correlatedScope(expr.query, ancestors);
	const orders = appendPrimaryKeyOrders(expr.query, expr.orderBy);
	const value = select(scope);
	const ordering = expressionOrderSql(orders, scope);
	return sql`(SELECT ${value} ${querySetSql(expr.query, scope)} ORDER BY ${ordering} LIMIT 1)`;
};

const compileAggregate = (
	expr: Extract<ScalarExpression, { type: "aggregate" }>,
	ancestors: CompileScope,
) => {
	if (ancestors.fuseAggregates && jsonElementAliasStack.length === 0) {
		const key = stableStringify({
			from: expr.query.from,
			joins: expr.query.joins ?? [],
			where: expr.query.where ?? null,
		});
		let group = ancestors.aggregates.get(key);
		if (!group) {
			group = {
				query: expr.query,
				measures: new Map(),
				scope: correlatedScope(expr.query, ancestors),
				alias: `aggregate${ancestors.size}_${ancestors.aggregates.size}`,
			};
			ancestors.aggregates.set(key, group);
		}
		const measureKey = stableStringify(expr.aggregation);
		let measure = group.measures.get(measureKey);
		if (!measure) {
			measure = {
				alias: `v${group.measures.size}`,
				value: compileAggregation(expr.aggregation, group.scope),
			};
			group.measures.set(measureKey, measure);
		}
		return qualifiedIdentifier(group.alias, measure.alias);
	}
	const scope = correlatedScope(expr.query, ancestors);
	const value = compileAggregation(expr.aggregation, scope);
	return sql`(SELECT ${value} ${querySetSql(expr.query, scope)})`;
};

const compileJsonArrayFrom = (
	array: ScalarExpression,
	scope: CompileScope,
): { readonly alias: string; readonly from: SqlFragment } => {
	const arraySql = compileExpression(array, scope);
	const alias = `j${jsonElementAliasCounter++}`;
	return {
		alias,
		from: sql`jsonb_array_elements(CASE WHEN jsonb_typeof(${arraySql}) = 'array' THEN ${arraySql} ELSE '[]'::jsonb END) AS ${sql.raw(alias)}(elem)`,
	};
};

const compileJsonArrayExists = (
	expr: Extract<ScalarExpression, { type: "jsonExists" }>,
	scope: CompileScope,
) => {
	const { from, alias } = compileJsonArrayFrom(expr.array, scope);
	return withJsonElementAlias(alias, () =>
		expr.where
			? sql`EXISTS (SELECT 1 FROM ${from} WHERE ${compilePredicate(expr.where, scope)})`
			: sql`EXISTS (SELECT 1 FROM ${from})`,
	);
};

const compileJsonArrayFirst = (
	expr: Extract<ScalarExpression, { type: "jsonFirst" }>,
	scope: CompileScope,
	select?: () => SqlFragment,
) => {
	const { from, alias } = compileJsonArrayFrom(expr.array, scope);
	return withJsonElementAlias(alias, () => {
		const selectSql = select ? select() : compileExpression(expr.select, scope);
		const where = expr.where ? sql`WHERE ${compilePredicate(expr.where, scope)}` : sql``;
		return sql`(SELECT ${selectSql} FROM ${from} ${where} ORDER BY ${expressionOrderSql(expr.orderBy, scope)} LIMIT 1)`;
	});
};

const compileJsonArrayCount = (
	expr: Extract<ScalarExpression, { type: "jsonCount" }>,
	scope: CompileScope,
) => {
	if (!expr.where) {
		return bindCastOperand(
			expr.array,
			scope,
			compileExpression(expr.array, scope),
			(array) =>
				sql`(CASE WHEN jsonb_typeof(${array}) = 'array' THEN jsonb_array_length(${array}) ELSE 0 END)::double precision`,
		);
	}
	const { from, alias } = compileJsonArrayFrom(expr.array, scope);
	return withJsonElementAlias(alias, () => {
		const where = expr.where ? sql`WHERE ${compilePredicate(expr.where, scope)}` : sql``;
		return sql`(SELECT COUNT(*)::double precision FROM ${from} ${where})`;
	});
};

const compileAggregation = (
	aggregation: AggregationSpec,
	scope: CompileScope,
	numericMinMax = false,
) => {
	let value: SqlFragment;
	if (aggregation.function === "count") {
		value = sql`COUNT(*)::double precision`;
	} else if (aggregation.function === "countDistinct") {
		value = sql`COUNT(DISTINCT ${compileExpression(aggregation.expr, scope)})::double precision`;
	} else if (
		aggregation.function === "sum" ||
		aggregation.function === "average" ||
		numericMinMax
	) {
		const operand = compileCast({ type: "cast", target: "number", expr: aggregation.expr }, scope);
		if (aggregation.function === "sum") {
			value = sql`SUM(${operand})`;
		} else if (aggregation.function === "average") {
			value = sql`AVG(${operand})`;
		} else if (aggregation.function === "minimum") {
			value = sql`MIN(${operand})`;
		} else {
			value = sql`MAX(${operand})`;
		}
	} else {
		const operand = compileExpression(aggregation.expr, scope);
		value = aggregation.function === "minimum" ? sql`MIN(${operand})` : sql`MAX(${operand})`;
	}
	return value;
};

const compileInclude = (
	include: ExpandedInclude,
	executionScope: RyotQLExecutionScope,
	ancestors: CompileScope,
	path: readonly number[],
	hoisted: SqlFragment[],
): SqlFragment => {
	const scope = buildScope(include, executionScope, `i${path.join("_")}`, ancestors);
	const root = requireCompileTable(scope, include.from.alias);
	let rootSource: undefined | SqlFragment;
	if (root.table.materializedInIncludes) {
		rootSource = identifier(`i${path.join("_")}source`);
		hoisted.push(sql`${rootSource} AS MATERIALIZED ${authorizedTable(root.table, executionScope)}`);
	}
	const orders = appendPrimaryKeyOrders(include, include.orderBy);
	const orderMetadata = orders.map((order) => ({
		direction: order.direction,
		kind: expressionKind(order.expr, scope),
	}));
	const ordering = orderSql(orderMetadata);
	const queryOrdering = expressionOrderSql(orders, scope);
	const fieldValues = include.fields.flatMap((field) =>
		hasRuntimeOutputKind(field.expr, scope)
			? [compileExpression(field.expr, scope), outputKind(field.expr, scope)]
			: [compileExpression(field.expr, scope)],
	);
	const nestedValues = (include.include ?? []).map((nested, index) =>
		compileInclude(nested, executionScope, scope, [...path, index], hoisted),
	);
	const itemValues = [...fieldValues, ...nestedValues];
	const item = sql`jsonb_build_array(${sql.join(itemValues, sql`, `)})`;
	const orderColumns = orders.map(
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
				${querySetSql(include, scope, [], rootSource)}
				ORDER BY ${queryOrdering}
				LIMIT ${include.limit + 1}
			) "orderedIncludeRows"
		) "indexedIncludeRows"
	)`;
};

const compileCursorColumn = (expr: ScalarExpression, scope: CompileScope) => {
	const value = compileExpression(expr, scope);
	return expressionKind(expr, scope) === "date"
		? sql`to_char(${value} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`
		: value;
};

const containsAggregate = (expr: ScalarExpression): boolean => {
	if (expr.type === "aggregate") {
		return true;
	}
	if ("expr" in expr) {
		return containsAggregate(expr.expr);
	}
	if (expr.type === "coalesce" || expr.type === "concat") {
		return expr.values.some(containsAggregate);
	}
	if (expr.type === "arithmetic") {
		return containsAggregate(expr.left) || containsAggregate(expr.right);
	}
	if (expr.type === "conditional") {
		return containsAggregate(expr.whenTrue) || containsAggregate(expr.whenFalse);
	}
	return false;
};

const bindAggregateOrders = (orders: ReadonlyArray<Order>, scope: CompileScope) => {
	for (const { expr } of orders) {
		const key = stableStringify(expr);
		if (!containsAggregate(expr) || scope.bindings.has(key)) {
			continue;
		}
		const value = compileExpression(expr, scope);
		const alias = `orderValue${scope.bindings.size}`;
		scope.bindings.set(key, {
			value: qualifiedIdentifier(alias, "value"),
			// Keep the correlated aggregate shared by output, ordering, and cursor predicates.
			source: sql`CROSS JOIN LATERAL (SELECT ${value} AS value OFFSET 0) ${identifier(alias)}`,
		});
	}
};

const compileRowsQuery = (
	query: RowsQuery,
	executionScope: RyotQLExecutionScope,
	cursor: undefined | readonly CursorValue[],
): SqlFragment => {
	const scope = buildScope(query, executionScope, "");
	const orders = appendPrimaryKeyOrders(query, query.output.orderBy);
	bindAggregateOrders(orders, scope);
	const fieldColumns = query.output.fields.flatMap((field, index) =>
		compileOutputColumns(field.expr, scope, `f${index}v`, `f${index}k`),
	);
	const orderColumns = orders.map(
		(order, index) => sql`${compileCursorColumn(order.expr, scope)} AS ${identifier(`o${index}`)}`,
	);
	const hoisted: SqlFragment[] = [];
	const includeColumns = (query.output.include ?? []).map(
		(include, index) =>
			sql`${compileInclude(include, executionScope, scope, [index], hoisted)} AS ${identifier(`i${index}`)}`,
	);
	const columns = [...fieldColumns, ...includeColumns, ...orderColumns];
	const pagination = query.output.pagination;
	const queryOrdering = expressionOrderSql(orders, scope);
	const cursorCondition = cursor ? [compileCursorPredicate(orders, cursor, scope)] : [];

	const statement = sql`
		SELECT ${sql.join(columns, sql`, `)}
		${querySetSql(query, scope, cursorCondition)}
		ORDER BY ${queryOrdering}
		LIMIT ${pagination.limit + 1}
	`;
	return withRelations(scope, statement, hoisted);
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
		return withRelations(
			scope,
			sql`SELECT ${sql.join(measureColumns, sql`, `)} ${querySetSql(query, scope)}`,
		);
	}
	if (query.output.limit === undefined || query.output.orderBy === undefined) {
		throw new Error("RyotQL grouped aggregate is missing limit or orderBy after validation");
	}
	let groupOrdinal = 1;
	const groupOrdinals = groups.flatMap((group) => {
		const count = hasRuntimeOutputKind(group.expr, scope) ? 2 : 1;
		return Array.from({ length: count }, () => groupOrdinal++);
	});
	const groupIndexes = new Map(groups.map((group, index) => [group.key, index]));
	const measureIndexes = new Map(
		query.output.measures.map((measure, index) => [measure.key, index]),
	);
	const ordering = query.output.orderBy.map((order) => {
		const groupIndex = groupIndexes.get(order.key);
		const measureIndex = measureIndexes.get(order.key);
		if (groupIndex === undefined && measureIndex === undefined) {
			throw new Error(`RyotQL compiler received unknown aggregate order key '${order.key}'`);
		}
		const group = groupIndex === undefined ? undefined : groups[groupIndex];
		const value = identifier(group === undefined ? `m${measureIndex}` : `g${groupIndex}v`);
		const collation =
			group !== undefined && expressionKind(group.expr, scope) === "text"
				? sql` COLLATE "C"`
				: sql``;
		const direction = order.direction === "asc" ? sql`ASC` : sql`DESC`;
		return sql`${value}${collation} ${direction} NULLS LAST`;
	});
	return withRelations(
		scope,
		sql`
		SELECT * FROM (
			SELECT
				${sql.join([...groupColumns, ...measureColumns], sql`, `)},
				COUNT(*) OVER()::integer AS "totalGroups"
			${querySetSql(query, scope)}
			GROUP BY ${sql.join(
				groupOrdinals.map((ordinal) => sql.raw(String(ordinal))),
				sql`, `,
			)}
		) "aggregateGroups"
		ORDER BY ${sql.join(ordering, sql`, `)}
		LIMIT ${query.output.limit}
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

const compileTimeSeriesQuery = (query: TimeSeriesQuery, executionScope: RyotQLExecutionScope) => {
	const scope = buildScope(query, executionScope, "");
	const time = compileExpression(query.output.time.expr, scope);
	const measure = compileAggregation(query.output.measure.aggregation, scope, true);
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
			${querySetSql(query, scope, [range])}
			GROUP BY 1
		)`;
	return withRelations(
		scope,
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
	include: ExpandedInclude,
	executionScope: RyotQLExecutionScope,
	ancestors: CompileScope,
): IncludeResult => {
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

const aggregationMeasureKind = (
	measure: AggregateMeasure,
	scope: CompileScope,
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
	scope: CompileScope,
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

const executeAggregateQuery = Effect.fn("executeRyotQLAggregateQuery")(function* (
	executionScope: RyotQLExecutionScope,
	query: AggregateQuery,
	queryName: string,
	db: EffectPgDatabase,
	budget: undefined | RyotQLResultBudget,
) {
	const raw = yield* executeSql(
		compileAggregateQuery(query, executionScope),
		queryName,
		db,
		budget,
	);
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
	db: EffectPgDatabase,
	budget: undefined | RyotQLResultBudget,
) {
	const raw = yield* executeSql(
		compileTimeSeriesQuery(query, executionScope),
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
	const scope = buildScope(rowsQuery, executionScope, "");
	const orders = appendPrimaryKeyOrders(rowsQuery, rowsQuery.output.orderBy);
	const orderKinds = orders.map((order) => expressionKind(order.expr, scope));
	const orderDirections = orders.map((order) => order.direction);
	const ownerIdentity = sha256Hex(
		encodeJson({
			scope: executionScope,
			references: pluginIdentityReferences({ queries: { query: rowsQuery } })
				.map((reference) => stableStringify(reference))
				.sort(),
		}),
	);
	const cursor = rowsQuery.output.pagination.after
		? yield* decodeCursor(
				rowsQuery.output.pagination.after,
				orderKinds,
				orderDirections,
				ownerIdentity,
			)
		: undefined;
	const raw = yield* executeSql(
		compileRowsQuery(rowsQuery, executionScope, cursor),
		queryName,
		db,
		budget,
	);
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
