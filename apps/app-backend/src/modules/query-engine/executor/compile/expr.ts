import { sql } from "drizzle-orm";

import type { AggregationSpec, Expr, FieldSelector, OrderByEntry, Source } from "../../language";
import {
	entitySourceSql,
	escapeContainsPattern,
	isSystemDateField,
	jsonbTypeofKindSql,
	propertyExtractSql,
	propertyExtractTextSql,
	schemaColumnSql,
	systemColumnSql,
	userVisibleSql,
	type SqlFragment,
} from "./fragments";
import type { CompileScope, SqlRef } from "./scope";

// The coarse SQL type an expression is compiled into. "json" means "not statically known" — the
// value is left as raw jsonb and compared/typed at runtime by its JSON type.
export type ScalarType = "number" | "text" | "boolean" | "date" | "json";

// An output value: a jsonb `value` column and a text `kind` column that reconstructOutputValue maps
// back to a FieldValue. `kind` may be a literal ('text') or a runtime CASE (nullable / property).
export type CompiledValue = { readonly value: SqlFragment; readonly kind: SqlFragment };

// Unreachable default for a union-exhaustive switch; `measureRef` is the only node the compilers
// intentionally give a degenerate value (it is resolved separately in aggregate order-by).
const absurdExpr = (_expr: never): never => {
	throw new Error("query-engine compile: unhandled expression node");
};

const COMPARISON_OP: Record<Extract<Expr, { type: "comparison" }>["operator"], SqlFragment> = {
	eq: sql`=`,
	neq: sql`<>`,
	gt: sql`>`,
	gte: sql`>=`,
	lt: sql`<`,
	lte: sql`<=`,
};

const literalScalarType = (expr: Extract<Expr, { type: "literal" }>): ScalarType => {
	if (expr.valueType === "date") {
		return "date";
	}
	const value = expr.value;
	if (typeof value === "boolean") {
		return "boolean";
	}
	if (typeof value === "number") {
		return "number";
	}
	if (typeof value === "string") {
		return "text";
	}
	return "json";
};

const refScalarType = (
	field: FieldSelector,
	scope: CompileScope,
	sourceAlias: string,
): ScalarType => {
	if (field.type === "schema") {
		return field.name === "isBuiltin" ? "boolean" : "text";
	}
	if (field.type === "system") {
		if (field.name === "properties") {
			return "json";
		}
		return isSystemDateField(scope.resolve(sourceAlias).kind, field.name) ? "date" : "text";
	}
	// Property values have no statically-known type (their schema is not consulted at compile time);
	// they are compared structurally / cast under a jsonb_typeof guard.
	return "json";
};

// The coarse type an expression compiles to, used to pick comparison/arithmetic operand casts.
const staticType = (expr: Expr, scope: CompileScope): ScalarType => {
	switch (expr.type) {
		case "literal":
			return literalScalarType(expr);
		case "ref":
			return refScalarType(expr.field, scope, expr.sourceAlias);
		case "arithmetic":
			return "number";
		case "aggregate":
			return "number";
		case "first":
			return staticType(expr.select, scope);
		case "coalesce": {
			const [first, ...rest] = expr.values.map((value) => staticType(value, scope));
			return first !== undefined && rest.every((type) => type === first) ? first : "json";
		}
		case "and":
		case "or":
		case "not":
		case "exists":
		case "isNull":
		case "contains":
		case "isNotNull":
		case "comparison":
			return "boolean";
		case "measureRef":
			return "number";
		default:
			return absurdExpr(expr);
	}
};

// A concrete scalar beats an unknown ("json"); two different concretes fall back to structural jsonb.
const commonComparisonType = (left: ScalarType, right: ScalarType): ScalarType => {
	if (left === right) {
		return left;
	}
	if (left === "json") {
		return right;
	}
	if (right === "json") {
		return left;
	}
	return "json";
};

const literalScalarSql = (
	expr: Extract<Expr, { type: "literal" }>,
	want: ScalarType,
): SqlFragment => {
	const value = expr.value;
	if (value === null || value === undefined) {
		return sql`NULL`;
	}
	if (want === "date") {
		return sql`${value}::timestamptz`;
	}
	if (want === "number") {
		return sql`${value}::double precision`;
	}
	if (want === "json") {
		return literalJsonbSql(expr);
	}
	// text / boolean bind directly.
	return sql`${value}`;
};

// Cast the bound param to a concrete type before to_jsonb: a bare `to_jsonb($1)` leaves Postgres
// unable to infer the parameter's type ("could not determine data type of parameter").
const literalJsonbSql = (expr: Extract<Expr, { type: "literal" }>): SqlFragment => {
	const value = expr.value;
	if (value === null || value === undefined) {
		return sql`NULL::jsonb`;
	}
	if (typeof value === "object") {
		return sql`${JSON.stringify(value)}::jsonb`;
	}
	if (typeof value === "boolean") {
		return sql`to_jsonb(${value}::boolean)`;
	}
	if (typeof value === "number") {
		return sql`to_jsonb(${value}::double precision)`;
	}
	return sql`to_jsonb(${value}::text)`;
};

// Kind is inlined as a SQL string literal (the value is a fixed enum), never a bound param — a bare
// param has no type context in a jsonb_build_object / SELECT position.
const literalKindSql = (expr: Extract<Expr, { type: "literal" }>): SqlFragment =>
	expr.value === null || expr.value === undefined
		? sql`'null'`
		: sql.raw(`'${literalScalarType(expr)}'`);

const slugGuardSql = (
	scope: CompileScope,
	sourceAlias: string,
	schema: string,
): SqlFragment | null => {
	const ref = scope.resolve(sourceAlias);
	return ref.schemas.length > 1 ? sql`${sql.raw(`${ref.sqlAlias}s`)}.slug = ${schema}` : null;
};

// Guarded property scalar: the cast runs only when the row is the right schema and the JSON value is
// the expected type; otherwise NULL, so wrong-schema and wrong-type values drop out of comparisons.
const propertyScalarSql = (
	scope: CompileScope,
	sourceAlias: string,
	field: Extract<FieldSelector, { type: "property" }>,
	want: ScalarType,
): SqlFragment => {
	const ref = scope.resolve(sourceAlias);
	const extract = propertyExtractSql(ref.sqlAlias, field.path);
	const extractText = propertyExtractTextSql(ref.sqlAlias, field.path);
	const slugGuard = slugGuardSql(scope, sourceAlias, field.schema);
	const guardPrefix = slugGuard ? sql`${slugGuard} AND ` : sql``;

	if (want === "json") {
		const guarded = slugGuard ? sql`CASE WHEN ${slugGuard} THEN ${extract} END` : extract;
		return sql`NULLIF(${guarded}, 'null'::jsonb)`;
	}
	const jsonType = want === "number" ? "number" : want === "boolean" ? "boolean" : "string";
	const cast =
		want === "number"
			? sql`(${extractText})::double precision`
			: want === "date"
				? sql`(${extractText})::timestamptz`
				: want === "boolean"
					? sql`(${extractText})::boolean`
					: extractText;
	return sql`CASE WHEN ${guardPrefix}jsonb_typeof(${extract}) = ${jsonType} THEN ${cast} END`;
};

const refScalarSql = (
	expr: Extract<Expr, { type: "ref" }>,
	scope: CompileScope,
	want: ScalarType,
): SqlFragment => {
	const ref = scope.resolve(expr.sourceAlias);
	if (expr.field.type === "system") {
		return systemColumnSql(ref.kind, expr.field.name, ref.sqlAlias) ?? sql`NULL`;
	}
	if (expr.field.type === "schema") {
		return schemaColumnSql(expr.field.name, ref.sqlAlias);
	}
	return propertyScalarSql(scope, expr.sourceAlias, expr.field, want);
};

// Aggregation applied inside a correlated subquery, resolving its operand in the sub-source scope.
const aggregateScalarSql = (
	aggregation: AggregationSpec,
	scope: CompileScope,
	fromWhere: SqlFragment,
): SqlFragment => {
	if (aggregation.function === "count") {
		if (aggregation.distinctBy === undefined) {
			return sql`(SELECT COUNT(*) ${fromWhere})`;
		}
		const distinct = compileValue(aggregation.distinctBy, scope).value;
		return sql`(SELECT COUNT(DISTINCT ${distinct}) ${fromWhere})`;
	}
	const fn =
		aggregation.function === "sum"
			? sql`SUM`
			: aggregation.function === "average"
				? sql`AVG`
				: aggregation.function === "minimum"
					? sql`MIN`
					: sql`MAX`;
	const operand = compileScalar(aggregation.expr, scope, "number");
	return sql`(SELECT ${fn}(${operand}) ${fromWhere})`;
};

// A scalar SQL expression of the requested type. "json" always yields jsonb (via compileValue), so
// structural comparisons and mixed-type paths stay well-typed.
export const compileScalar = (expr: Expr, scope: CompileScope, want: ScalarType): SqlFragment => {
	if (want === "json") {
		return compileValue(expr, scope).value;
	}
	switch (expr.type) {
		case "literal":
			return literalScalarSql(expr, want);
		case "ref":
			return refScalarSql(expr, scope, want);
		case "arithmetic":
			return arithmeticSql(expr, scope);
		case "aggregate": {
			const { fromWhere, scope: childScope } = compileCorrelatedSource(expr.source, scope);
			return aggregateScalarSql(expr.aggregation, childScope, fromWhere);
		}
		case "first":
			return firstScalarSql(expr, scope, want);
		case "exists":
		case "and":
		case "or":
		case "not":
		case "isNull":
		case "isNotNull":
		case "contains":
		case "comparison":
			return compileBool(expr, scope);
		case "coalesce":
			return sql`COALESCE(${sql.join(
				expr.values.map((value) => compileScalar(value, scope, want)),
				sql`, `,
			)})`;
		case "measureRef":
			return sql`NULL`;
		default:
			return absurdExpr(expr);
	}
};

const arithmeticSql = (
	expr: Extract<Expr, { type: "arithmetic" }>,
	scope: CompileScope,
): SqlFragment => {
	const left = compileScalar(expr.left, scope, "number");
	const right = compileScalar(expr.right, scope, "number");
	if (expr.operator === "divide") {
		return sql`((${left}) / NULLIF((${right}), 0))`;
	}
	const op = expr.operator === "add" ? sql`+` : expr.operator === "subtract" ? sql`-` : sql`*`;
	return sql`((${left}) ${op} (${right}))`;
};

const firstScalarSql = (
	expr: Extract<Expr, { type: "first" }>,
	scope: CompileScope,
	want: ScalarType,
): SqlFragment => {
	const { fromWhere, scope: childScope } = compileCorrelatedSource(expr.source, scope);
	const select =
		want === "json"
			? compileValue(expr.select, childScope).value
			: compileScalar(expr.select, childScope, want);
	const orderBy = compileOrderBySql(expr.orderBy, childScope);
	return sql`(SELECT ${select} ${fromWhere} ORDER BY ${orderBy} LIMIT 1)`;
};

// Structural / mixed-type ordering when neither operand has a known scalar type: compare only when
// both runtime jsonb types match (number↔number, string↔string), else false.
const unknownOrderingSql = (
	left: Expr,
	right: Expr,
	scope: CompileScope,
	op: SqlFragment,
): SqlFragment => {
	const la = compileValue(left, scope).value;
	const ra = compileValue(right, scope).value;
	return sql`COALESCE(CASE
		WHEN jsonb_typeof(${la}) = 'number' AND jsonb_typeof(${ra}) = 'number'
			THEN ((${la})::text::double precision) ${op} ((${ra})::text::double precision)
		WHEN jsonb_typeof(${la}) = 'string' AND jsonb_typeof(${ra}) = 'string'
			THEN ((${la}) #>> '{}') COLLATE "C" ${op} ((${ra}) #>> '{}') COLLATE "C"
		ELSE false END, false)`;
};

const comparisonSql = (
	expr: Extract<Expr, { type: "comparison" }>,
	scope: CompileScope,
): SqlFragment => {
	const op = COMPARISON_OP[expr.operator];
	const common = commonComparisonType(staticType(expr.left, scope), staticType(expr.right, scope));
	if (common === "json") {
		if (expr.operator === "eq" || expr.operator === "neq") {
			const left = compileValue(expr.left, scope).value;
			const right = compileValue(expr.right, scope).value;
			return sql`COALESCE((${left}) ${op} (${right}), false)`;
		}
		return unknownOrderingSql(expr.left, expr.right, scope, op);
	}
	const left = compileScalar(expr.left, scope, common);
	const right = compileScalar(expr.right, scope, common);
	if (common === "text") {
		return sql`COALESCE((${left}) COLLATE "C" ${op} (${right}) COLLATE "C", false)`;
	}
	return sql`COALESCE((${left}) ${op} (${right}), false)`;
};

const containsSql = (
	expr: Extract<Expr, { type: "contains" }>,
	scope: CompileScope,
): SqlFragment => {
	const left = compileValue(expr.left, scope).value;
	const right = compileValue(expr.right, scope).value;
	// A literal needle is escaped in JS and bound; otherwise escape %/_/\ in SQL before the ILIKE.
	const pattern =
		expr.right.type === "literal" && typeof expr.right.value === "string"
			? sql`${escapeContainsPattern(expr.right.value)}`
			: sql`('%' || replace(replace(replace((${right}) #>> '{}', '\\', '\\\\'), '%', '\\%'), '_', '\\_') || '%')`;
	return sql`COALESCE(CASE
		WHEN jsonb_typeof(${left}) = 'string' AND jsonb_typeof(${right}) = 'string'
			THEN ((${left}) #>> '{}') ILIKE ${pattern}
		WHEN jsonb_typeof(${left}) IN ('array', 'object')
			THEN (${left}) @> (${right})
		ELSE false END, false)`;
};

const nullCheckSql = (
	expr: Extract<Expr, { type: "isNull" | "isNotNull" }>,
	scope: CompileScope,
): SqlFragment => {
	const value = compileScalar(expr.expr, scope, "json");
	return expr.type === "isNull" ? sql`(${value} IS NULL)` : sql`(${value} IS NOT NULL)`;
};

// A SQL boolean that is TRUE only when the underlying value is `true` (null-as-false), so it
// composes correctly under AND / OR / NOT.
export const compileBool = (expr: Expr, scope: CompileScope): SqlFragment => {
	switch (expr.type) {
		case "comparison":
			return comparisonSql(expr, scope);
		case "contains":
			return containsSql(expr, scope);
		case "isNull":
		case "isNotNull":
			return nullCheckSql(expr, scope);
		case "and":
			return sql`(${sql.join(
				expr.values.map((value) => compileBool(value, scope)),
				sql` AND `,
			)})`;
		case "or":
			return sql`(${sql.join(
				expr.values.map((value) => compileBool(value, scope)),
				sql` OR `,
			)})`;
		case "not":
			return sql`(NOT ${compileBool(expr.expr, scope)})`;
		case "exists": {
			const { fromWhere } = compileCorrelatedSource(expr.source, scope);
			return sql`EXISTS (SELECT 1 ${fromWhere})`;
		}
		case "literal":
		case "ref":
		case "arithmetic":
		case "aggregate":
		case "first":
		case "coalesce":
		case "measureRef":
			return sql`COALESCE(${compileScalar(expr, scope, "boolean")}, false)`;
		default:
			return absurdExpr(expr);
	}
};

const toJsonbValue = (scalar: SqlFragment): SqlFragment => sql`to_jsonb(${scalar})`;

const nullableKindSql = (column: SqlFragment, kind: string): SqlFragment =>
	sql`CASE WHEN ${column} IS NULL THEN 'null' ELSE ${kind} END`;

const refValue = (expr: Extract<Expr, { type: "ref" }>, scope: CompileScope): CompiledValue => {
	const ref = scope.resolve(expr.sourceAlias);
	if (expr.field.type === "system") {
		const column = systemColumnSql(ref.kind, expr.field.name, ref.sqlAlias) ?? sql`NULL`;
		if (expr.field.name === "properties") {
			return { value: column, kind: sql`'json'` };
		}
		const kind = isSystemDateField(ref.kind, expr.field.name) ? "date" : "text";
		return { value: toJsonbValue(column), kind: nullableKindSql(column, kind) };
	}
	if (expr.field.type === "schema") {
		const column = schemaColumnSql(expr.field.name, ref.sqlAlias);
		return {
			value: toJsonbValue(column),
			kind: expr.field.name === "isBuiltin" ? sql`'boolean'` : sql`'text'`,
		};
	}
	const value = propertyScalarSql(scope, expr.sourceAlias, expr.field, "json");
	return { value, kind: jsonbTypeofKindSql(value) };
};

const firstValue = (expr: Extract<Expr, { type: "first" }>, scope: CompileScope): CompiledValue => {
	// The select references the sub-source's own aliases, so its kind must be resolved in the
	// correlated child scope — not the outer scope.
	const { fromWhere, scope: childScope } = compileCorrelatedSource(expr.source, scope);
	const selectValue = compileValue(expr.select, childScope).value;
	const orderBy = compileOrderBySql(expr.orderBy, childScope);
	const value = sql`(SELECT ${selectValue} ${fromWhere} ORDER BY ${orderBy} LIMIT 1)`;
	// A property select's kind follows the returned value's runtime type; other selects have a known
	// static kind (null when no row matched).
	if (staticType(expr.select, childScope) === "json") {
		return { value, kind: jsonbTypeofKindSql(value) };
	}
	return { value, kind: nullableKindSql(value, exprStaticKind(expr.select, childScope)) };
};

const exprStaticKind = (expr: Expr, scope: CompileScope): string => {
	const type = staticType(expr, scope);
	return type === "text" || type === "date" || type === "number" || type === "boolean"
		? type
		: "json";
};

// An output field: a jsonb value column and a text kind column. Every Expr compiles here.
export const compileValue = (expr: Expr, scope: CompileScope): CompiledValue => {
	switch (expr.type) {
		case "literal":
			return { value: literalJsonbSql(expr), kind: literalKindSql(expr) };
		case "ref":
			return refValue(expr, scope);
		case "arithmetic": {
			const scalar = arithmeticSql(expr, scope);
			return { value: toJsonbValue(scalar), kind: nullableKindSql(scalar, "number") };
		}
		case "comparison":
		case "contains":
		case "isNull":
		case "isNotNull":
		case "and":
		case "or":
		case "not":
		case "exists":
			return { value: toJsonbValue(compileBool(expr, scope)), kind: sql`'boolean'` };
		case "aggregate": {
			const { fromWhere, scope: childScope } = compileCorrelatedSource(expr.source, scope);
			const scalar = aggregateScalarSql(expr.aggregation, childScope, fromWhere);
			const kind =
				expr.aggregation.function === "count" ? sql`'number'` : nullableKindSql(scalar, "number");
			return { value: toJsonbValue(scalar), kind };
		}
		case "first":
			return firstValue(expr, scope);
		case "coalesce": {
			const branches = expr.values.map((value) => {
				const compiled = compileValue(value, scope);
				return { present: sql`NULLIF(${compiled.value}, 'null'::jsonb)`, kind: compiled.kind };
			});
			const value = sql`COALESCE(${sql.join(
				branches.map((branch) => branch.present),
				sql`, `,
			)})`;
			const kindCases = branches.map(
				(branch) => sql`WHEN ${branch.present} IS NOT NULL THEN ${branch.kind}`,
			);
			return { value, kind: sql`CASE ${sql.join(kindCases, sql` `)} ELSE 'null' END` };
		}
		case "measureRef":
			return { value: sql`NULL::jsonb`, kind: sql`'null'` };
		default:
			return absurdExpr(expr);
	}
};

// ORDER BY fragment for a list of entries, typed so text sorts under COLLATE "C" and numbers/dates
// sort by their scalar value. Used by `first` and (re-exported) by the select-list compiler.
export const compileOrderBySql = (
	orderBy: readonly OrderByEntry[],
	scope: CompileScope,
): SqlFragment =>
	sql.join(
		orderBy.map((entry) => {
			const direction = entry.order === "asc" ? sql`ASC` : sql`DESC`;
			const type = staticType(entry.expr, scope);
			if (type === "text") {
				return sql`${compileScalar(entry.expr, scope, "text")} COLLATE "C" ${direction}`;
			}
			if (type === "number" || type === "date" || type === "boolean") {
				return sql`${compileScalar(entry.expr, scope, type)} ${direction}`;
			}
			return sql`${compileValue(entry.expr, scope).value} ${direction}`;
		}),
		sql`, `,
	);

type CorrelatedSource = { readonly fromWhere: SqlFragment; readonly scope: CompileScope };

const slugListSql = (schemas: readonly string[]): SqlFragment =>
	sql.join(
		schemas.map((slug) => sql`${slug}`),
		sql`, `,
	);

const whereTail = (where: SqlFragment | null): SqlFragment => (where ? sql`AND ${where}` : sql``);

// Compiles an `exists`/`aggregate`/`first` sub-source into a correlated FROM+WHERE and the child
// scope its alias resolves in. Visibility is re-derived inline (schema-slug joins + user_id) at
// every level, so nesting can never widen scope. Numbered aliases keep every level unique.
const compileCorrelatedSource = (source: Source, parentScope: CompileScope): CorrelatedSource => {
	const userId = parentScope.userId;
	const language = parentScope.language;
	const suffix = parentScope.freshSuffix();

	if (source.type === "events") {
		const ev = `ev${suffix}`;
		const evs = `${ev}s`;
		const anchor = parentScope.resolve(source.entityRef);
		const scope = parentScope.child(
			new Map<string, SqlRef>([
				[source.alias, { kind: "event", sqlAlias: ev, schemas: source.schemas }],
			]),
		);
		const where = source.where ? compileBool(source.where, scope) : null;
		const fromWhere = sql`
			FROM event ${sql.raw(ev)}
			JOIN event_schema ${sql.raw(evs)} ON ${sql.raw(evs)}.id = ${sql.raw(ev)}.event_schema_id
				AND ${sql.raw(evs)}.entity_schema_id = ${sql.raw(anchor.sqlAlias)}.entity_schema_id
				AND ${sql.raw(evs)}.slug IN (${slugListSql(source.schemas)})
				AND ${userVisibleSql(evs, userId)}
			WHERE ${sql.raw(ev)}.entity_id = ${sql.raw(anchor.sqlAlias)}.id
				AND ${sql.raw(ev)}.user_id = ${userId}
				${whereTail(where)}
		`;
		return { fromWhere, scope };
	}

	if (source.via === undefined) {
		const e = `e${suffix}`;
		const es = `${e}s`;
		const scope = parentScope.child(
			new Map<string, SqlRef>([
				[source.alias, { kind: "entity", sqlAlias: e, schemas: source.schemas }],
			]),
		);
		const where = source.where ? compileBool(source.where, scope) : null;
		const fromWhere = sql`
			FROM ${entitySourceSql(language)} ${sql.raw(e)}
			JOIN entity_schema ${sql.raw(es)} ON ${sql.raw(es)}.id = ${sql.raw(e)}.entity_schema_id
				AND ${sql.raw(es)}.slug IN (${slugListSql(source.schemas)})
				AND ${userVisibleSql(es, userId)}
			WHERE ${userVisibleSql(e, userId)}
				${whereTail(where)}
		`;
		return { fromWhere, scope };
	}

	const via = source.via;
	const e = `e${suffix}`;
	const es = `${e}s`;
	const r = `r${suffix}`;
	const rs = `${r}s`;
	const anchor = parentScope.resolve(via.entityRef);
	const anchorColumn = via.direction === "outgoing" ? "source_entity_id" : "target_entity_id";
	const childColumn = via.direction === "outgoing" ? "target_entity_id" : "source_entity_id";
	const scope = parentScope.child(
		new Map<string, SqlRef>([
			[source.alias, { kind: "entity", sqlAlias: e, schemas: source.schemas }],
			[via.alias, { kind: "relationship", sqlAlias: r, schemas: [via.schema] }],
		]),
	);
	const where = source.where ? compileBool(source.where, scope) : null;
	const fromWhere = sql`
		FROM relationship ${sql.raw(r)}
		JOIN relationship_schema ${sql.raw(rs)} ON ${sql.raw(rs)}.id = ${sql.raw(r)}.relationship_schema_id
			AND ${sql.raw(rs)}.slug = ${via.schema}
			AND ${userVisibleSql(rs, userId)}
		JOIN ${entitySourceSql(language)} ${sql.raw(e)} ON ${sql.raw(e)}.id = ${sql.raw(`${r}.${childColumn}`)}
		JOIN entity_schema ${sql.raw(es)} ON ${sql.raw(es)}.id = ${sql.raw(e)}.entity_schema_id
			AND ${sql.raw(es)}.slug IN (${slugListSql(source.schemas)})
			AND ${userVisibleSql(es, userId)}
		WHERE ${sql.raw(`${r}.${anchorColumn}`)} = ${sql.raw(anchor.sqlAlias)}.id
			AND ${userVisibleSql(r, userId)}
			AND ${userVisibleSql(e, userId)}
			${whereTail(where)}
	`;
	return { fromWhere, scope };
};
