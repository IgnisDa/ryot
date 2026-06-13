import { sql } from "drizzle-orm";

import type {
	AggregationSpec,
	EntitySource,
	Expr,
	FieldSelector,
	IncludeEntry,
	NestedEventSource,
	RelationshipSource,
	RootEventSource,
	RootSource,
	RowsOutput,
	TimeSeriesOutput,
} from "../language";
import { SYSTEM_DATE_FIELDS_BY_KIND, type RootAliasKind } from "./types";

// Correlated subquery scans allocate numbered aliases (e1, ev1, r1, ...); recognize them by
// prefix so the same field-selector mapping serves both the outer scan and the subqueries.
const isEventAlias = (alias: string) => alias === "ev" || /^ev\d+$/.test(alias);
const isRelationshipAlias = (alias: string) => alias === "r" || /^r\d+$/.test(alias);

const systemFieldSql = (name: string, alias = "e"): ReturnType<typeof sql> | null => {
	const table = sql.raw(alias);

	if (isEventAlias(alias)) {
		const eventColumnMap: Record<string, ReturnType<typeof sql>> = {
			id: sql`${table}.id`,
			userId: sql`${table}.user_id`,
			entityId: sql`${table}.entity_id`,
			createdAt: sql`${table}.created_at`,
			updatedAt: sql`${table}.updated_at`,
			properties: sql`${table}.properties`,
			occurredAt: sql`${table}.occurred_at`,
			eventSchemaId: sql`${table}.event_schema_id`,
			sessionEntityId: sql`${table}.session_entity_id`,
		};
		return eventColumnMap[name] ?? null;
	}

	if (isRelationshipAlias(alias)) {
		const relationshipColumnMap: Record<string, ReturnType<typeof sql>> = {
			id: sql`${table}.id`,
			createdAt: sql`${table}.created_at`,
			sourceEntityId: sql`${table}.source_entity_id`,
			targetEntityId: sql`${table}.target_entity_id`,
		};
		return relationshipColumnMap[name] ?? null;
	}

	const columnMap: Record<string, ReturnType<typeof sql>> = {
		id: sql`${table}.id`,
		name: sql`${table}.name`,
		userId: sql`${table}.user_id`,
		createdAt: sql`${table}.created_at`,
		updatedAt: sql`${table}.updated_at`,
		properties: sql`${table}.properties`,
		externalId: sql`${table}.external_id`,
		populatedAt: sql`${table}.populated_at`,
		entitySchemaId: sql`${table}.entity_schema_id`,
		sandboxScriptId: sql`${table}.sandbox_script_id`,
	};
	return columnMap[name] ?? null;
};

export const fieldSelectorToOrderSql = (
	field: FieldSelector,
	sourceSchemas: readonly [string, ...string[]],
	alias = "e",
): ReturnType<typeof sql> | null => {
	if (field.type === "system") {
		return systemFieldSql(field.name, alias);
	}

	const schemaTable = sql.raw(`${alias}s`);

	if (field.type === "property") {
		const pathArgs = field.path.map((key) => sql`${key}`);
		const propertiesExpr = sql`${sql.raw(alias)}.properties`;
		// jsonb (not _text) so numeric properties sort numerically (2 before 10), not as text.
		const jsonbExpr = sql`jsonb_extract_path(${propertiesExpr}, ${sql.join(pathArgs, sql`, `)})`;

		if (alias === "r" || sourceSchemas.length === 1) {
			return jsonbExpr;
		}

		return sql`CASE WHEN ${schemaTable}.slug = ${field.schema} THEN ${jsonbExpr} END`;
	}

	return field.name === "slug"
		? sql`${schemaTable}.slug`
		: field.name === "isBuiltin"
			? sql`${schemaTable}.is_builtin`
			: sql`${schemaTable}.name`;
};

type OrderByTarget = { alias: string; schemas: readonly [string, ...string[]] };

export const buildOrderBySql = (
	orderBy: readonly { readonly order: "asc" | "desc"; readonly expr: Expr }[],
	resolve: (ref: Extract<Expr, { type: "ref" }>) => OrderByTarget | null,
): ReturnType<typeof sql> =>
	sql.join(
		orderBy.map((entry) => {
			if (entry.expr.type !== "ref") {
				return sql`1`;
			}
			const target = resolve(entry.expr);
			if (!target) {
				return sql`1`;
			}
			const exprSql = fieldSelectorToOrderSql(entry.expr.field, target.schemas, target.alias);
			if (!exprSql) {
				return sql`1`;
			}
			return entry.order === "asc" ? sql`${exprSql} ASC` : sql`${exprSql} DESC`;
		}),
		sql`, `,
	);

type SqlFragment = ReturnType<typeof sql>;

type WherePushdownTarget = { alias: string; schemas: readonly string[] };

type WherePushdownResolve = (ref: Extract<Expr, { type: "ref" }>) => WherePushdownTarget | null;

type WherePushdownResult = {
	readonly conditions: SqlFragment[];
	readonly residual: Expr | null;
};

// When present, `exists` and `aggregate` count comparisons compile to SQL subqueries; `alloc`
// hands out unique numeric suffixes for their table aliases.
type SubqueryCtx = { readonly userId: string; readonly alloc: () => number };
type PushdownCtx = {
	readonly resolve: WherePushdownResolve;
	readonly subquery: SubqueryCtx | null;
};

// Text columns only; timestamp/jsonb columns compare differently app-side, so they stay residual.
// `se`/`te` are relationship-root endpoint entities and share the entity column set; `r` is the
// relationship edge (only its text ids push — createdAt is a timestamp).
const ENTITY_TEXT_SYSTEM_FIELDS = new Set([
	"id",
	"name",
	"userId",
	"externalId",
	"sandboxScriptId",
]);
const TEXT_SYSTEM_FIELDS_BY_ALIAS: Record<string, ReadonlySet<string>> = {
	e: ENTITY_TEXT_SYSTEM_FIELDS,
	se: ENTITY_TEXT_SYSTEM_FIELDS,
	te: ENTITY_TEXT_SYSTEM_FIELDS,
	ev: new Set(["id", "userId", "entityId", "sessionEntityId"]),
	r: new Set(["id", "sourceEntityId", "targetEntityId"]),
};

const isTextSystemField = (name: string, alias: string): boolean =>
	TEXT_SYSTEM_FIELDS_BY_ALIAS[alias]?.has(name) ?? false;

const COMPARISON_OP_SQL: Record<"eq" | "gt" | "gte" | "lt" | "lte", SqlFragment> = {
	eq: sql`=`,
	gt: sql`>`,
	gte: sql`>=`,
	lt: sql`<`,
	lte: sql`<=`,
};

const nonEmptyAndExpr = (values: Expr[]): Expr | null => {
	const [first, ...rest] = values;
	if (first === undefined) {
		return null;
	}
	if (rest.length === 0) {
		return first;
	}

	return { type: "and", values: [first, ...rest] };
};

const propertyExtractSql = (alias: string, path: readonly string[]): SqlFragment => {
	const pathArgs = path.map((key) => sql`${key}`);
	return sql`jsonb_extract_path(${sql.raw(alias)}.properties, ${sql.join(pathArgs, sql`, `)})`;
};

const propertyExtractTextSql = (alias: string, path: readonly string[]): SqlFragment => {
	const pathArgs = path.map((key) => sql`${key}`);
	return sql`jsonb_extract_path_text(${sql.raw(alias)}.properties, ${sql.join(pathArgs, sql`, `)})`;
};

// Escape the needle so % and _ match literally inside an ILIKE pattern (backslash first).
const escapeContainsPattern = (value: string): string =>
	`%${value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_")}%`;

// A property reads as null on rows of any other schema, so a multi-schema source needs the guard.
const propertySlugGuard = (target: WherePushdownTarget, schema: string): SqlFragment | null =>
	target.schemas.length > 1 ? sql`${sql.raw(`${target.alias}s`)}.slug = ${schema}` : null;

const isSqlFragment = (value: SqlFragment | null): value is SqlFragment => value !== null;

const andConditions = (conditions: readonly (SqlFragment | null)[]): SqlFragment =>
	sql`(${sql.join(conditions.filter(isSqlFragment), sql` AND `)})`;

// CASE (not AND) so the ::numeric/::boolean cast runs only when the jsonb_typeof guard holds:
// Postgres may evaluate a bare AND's cast before the guard and raise on non-numeric data.
const guardedCastPredicate = (guards: readonly (SqlFragment | null)[], predicate: SqlFragment) =>
	sql`(CASE WHEN ${sql.join(guards.filter(isSqlFragment), sql` AND `)} THEN (${predicate}) ELSE false END)`;

const comparisonRefLiteral = (expr: Extract<Expr, { type: "comparison" }>) => {
	const ref = expr.left.type === "ref" ? expr.left : expr.right.type === "ref" ? expr.right : null;
	const literal =
		expr.left.type === "literal" ? expr.left : expr.right.type === "literal" ? expr.right : null;
	return ref && literal ? { ref, literal, refIsLeft: expr.left.type === "ref" } : null;
};

const compileComparisonSql = (
	expr: Extract<Expr, { type: "comparison" }>,
	resolve: WherePushdownResolve,
): SqlFragment | null => {
	if (expr.operator === "neq") {
		return null;
	}
	const operands = comparisonRefLiteral(expr);
	if (!operands || operands.literal.valueType === "date") {
		return null;
	}
	const { ref, literal, refIsLeft } = operands;
	const value = literal.value;
	const target = resolve(ref);
	if (!target) {
		return null;
	}

	if (ref.field.type === "system") {
		if (
			expr.operator !== "eq" ||
			typeof value !== "string" ||
			!isTextSystemField(ref.field.name, target.alias)
		) {
			return null;
		}
		const column = systemFieldSql(ref.field.name, target.alias);
		return column ? sql`(${column} = ${value})` : null;
	}

	if (ref.field.type !== "property") {
		return null;
	}

	const { schema, path } = ref.field;
	const slugGuard = propertySlugGuard(target, schema);
	const extract = propertyExtractSql(target.alias, path);
	const extractText = propertyExtractTextSql(target.alias, path);

	if (typeof value === "number") {
		const op = COMPARISON_OP_SQL[expr.operator];
		const numeric = sql`${extractText}::numeric`;
		const predicate = refIsLeft ? sql`${numeric} ${op} ${value}` : sql`${value} ${op} ${numeric}`;
		return guardedCastPredicate([slugGuard, sql`jsonb_typeof(${extract}) = 'number'`], predicate);
	}

	// Only numeric literals push ordering comparisons; string/date ordering is collation-dependent.
	if (expr.operator !== "eq") {
		return null;
	}

	if (typeof value === "string") {
		return andConditions([
			slugGuard,
			sql`jsonb_typeof(${extract}) = 'string'`,
			sql`${extractText} = ${value}`,
		]);
	}

	if (typeof value === "boolean") {
		return guardedCastPredicate(
			[slugGuard, sql`jsonb_typeof(${extract}) = 'boolean'`],
			sql`${extractText}::boolean = ${value}`,
		);
	}

	return null;
};

const compileContainsSql = (
	expr: Extract<Expr, { type: "contains" }>,
	resolve: WherePushdownResolve,
): SqlFragment | null => {
	if (expr.left.type !== "ref" || expr.right.type !== "literal") {
		return null;
	}
	const needle = expr.right.value;
	if (typeof needle !== "string") {
		return null;
	}
	const target = resolve(expr.left);
	if (!target) {
		return null;
	}
	const pattern = escapeContainsPattern(needle);

	if (expr.left.field.type === "system") {
		if (!isTextSystemField(expr.left.field.name, target.alias)) {
			return null;
		}
		const column = systemFieldSql(expr.left.field.name, target.alias);
		return column ? sql`(${column} ILIKE ${pattern})` : null;
	}

	if (expr.left.field.type !== "property") {
		return null;
	}

	const { schema, path } = expr.left.field;
	return andConditions([
		propertySlugGuard(target, schema),
		sql`jsonb_typeof(${propertyExtractSql(target.alias, path)}) = 'string'`,
		sql`${propertyExtractTextSql(target.alias, path)} ILIKE ${pattern}`,
	]);
};

const compileNullCheckSql = (
	expr: Extract<Expr, { type: "isNull" | "isNotNull" }>,
	resolve: WherePushdownResolve,
): SqlFragment | null => {
	if (expr.expr.type !== "ref") {
		return null;
	}
	const target = resolve(expr.expr);
	if (!target) {
		return null;
	}
	const field = expr.expr.field;

	if (field.type === "system") {
		const column = systemFieldSql(field.name, target.alias);
		if (!column) {
			return null;
		}
		return expr.type === "isNull" ? sql`(${column} IS NULL)` : sql`(${column} IS NOT NULL)`;
	}

	if (field.type !== "property") {
		return null;
	}

	// Multi-schema would need a per-schema CASE; leave those to the residual.
	if (target.schemas.length > 1) {
		return null;
	}

	// jsonb_extract_path yields 'null'::jsonb (not SQL NULL) for a JSON null, which reads as null.
	const normalized = sql`nullif(${propertyExtractSql(target.alias, field.path)}, 'null'::jsonb)`;
	return expr.type === "isNull" ? sql`(${normalized} IS NULL)` : sql`(${normalized} IS NOT NULL)`;
};

const flattenAndExpr = (expr: Expr): Expr[] =>
	expr.type === "and" ? expr.values.flatMap(flattenAndExpr) : [expr];

export const wherePushdownSql = (conditions: readonly SqlFragment[]) =>
	conditions.length > 0 ? sql`AND ${sql.join([...conditions], sql` AND `)}` : sql``;

// Resolvers key only off sourceAlias; a synthetic ref reuses them to look up an ancestor's SQL alias.
const SYSTEM_ID_FIELD: FieldSelector = { type: "system", name: "id" };
const resolveAlias = (resolve: WherePushdownResolve, alias: string): WherePushdownTarget | null =>
	resolve({ type: "ref", sourceAlias: alias, field: SYSTEM_ID_FIELD });

// Compiles a sub-source's whole `where` to SQL conditions, or null if any conjunct is not fully
// pushable — the enclosing exists/aggregate then stays app-side rather than dropping the residual.
function compileSubWhere(where: Expr | null, ctx: PushdownCtx): SqlFragment[] | null {
	if (!where) {
		return [];
	}
	const conditions: SqlFragment[] = [];
	for (const conjunct of flattenAndExpr(where)) {
		const compiled = compileBoolExprToSql(conjunct, ctx);
		if (!compiled) {
			return null;
		}
		conditions.push(compiled);
	}
	return conditions;
}

// Builds a correlated subquery FROM+WHERE for an exists/aggregate sub-source, mirroring the
// standalone subsource scans. Visibility uses schema-slug joins (reference validation already
// confirmed every sub-source schema is visible). Returns null when the anchor alias is not in SQL
// scope or the sub-where is not fully pushable, so the caller keeps the app-side evaluation.
function compileCorrelatedSubsource(
	source: EntitySource | NestedEventSource,
	ctx: PushdownCtx,
): SqlFragment | null {
	if (!ctx.subquery) {
		return null;
	}
	const { userId, alloc } = ctx.subquery;
	const suffix = alloc();

	if (source.type === "events") {
		const anchor = resolveAlias(ctx.resolve, source.entityRef);
		if (!anchor) {
			return null;
		}
		const ev = sql.raw(`ev${suffix}`);
		const evs = sql.raw(`ev${suffix}s`);
		const parent = sql.raw(anchor.alias);
		const subResolve: WherePushdownResolve = (ref) =>
			ref.sourceAlias === source.alias
				? { alias: `ev${suffix}`, schemas: source.schemas }
				: ctx.resolve(ref);
		const subConditions = compileSubWhere(source.where, {
			resolve: subResolve,
			subquery: ctx.subquery,
		});
		if (subConditions === null) {
			return null;
		}
		return sql`
			FROM event ${ev}
			JOIN event_schema ${evs} ON ${evs}.id = ${ev}.event_schema_id
				AND ${evs}.entity_schema_id = ${parent}.entity_schema_id
				AND ${evs}.slug IN (${sql.join(
					source.schemas.map((slug) => sql`${slug}`),
					sql`, `,
				)})
				AND (${evs}.user_id = ${userId} OR ${evs}.user_id IS NULL)
			WHERE ${ev}.entity_id = ${parent}.id
				AND ${ev}.user_id = ${userId}
				${wherePushdownSql(subConditions)}
		`;
	}

	if (source.via === undefined) {
		return null;
	}
	const via = source.via;
	const anchor = resolveAlias(ctx.resolve, via.entityRef);
	if (!anchor) {
		return null;
	}
	const e = sql.raw(`e${suffix}`);
	const es = sql.raw(`e${suffix}s`);
	const r = sql.raw(`r${suffix}`);
	const rs = sql.raw(`r${suffix}s`);
	const parent = sql.raw(anchor.alias);
	const anchorColumn =
		via.direction === "outgoing" ? sql`${r}.source_entity_id` : sql`${r}.target_entity_id`;
	const childColumn =
		via.direction === "outgoing" ? sql`${r}.target_entity_id` : sql`${r}.source_entity_id`;
	const subResolve: WherePushdownResolve = (ref) =>
		ref.sourceAlias === source.alias
			? { alias: `e${suffix}`, schemas: source.schemas }
			: ref.sourceAlias === via.alias
				? { alias: `r${suffix}`, schemas: [via.schema] }
				: ctx.resolve(ref);
	const subConditions = compileSubWhere(source.where, {
		resolve: subResolve,
		subquery: ctx.subquery,
	});
	if (subConditions === null) {
		return null;
	}
	return sql`
		FROM relationship ${r}
		JOIN relationship_schema ${rs} ON ${rs}.id = ${r}.relationship_schema_id
			AND ${rs}.slug = ${via.schema}
			AND (${rs}.user_id = ${userId} OR ${rs}.user_id IS NULL)
		JOIN entity ${e} ON ${e}.id = ${childColumn}
		JOIN entity_schema ${es} ON ${es}.id = ${e}.entity_schema_id
			AND ${es}.slug IN (${sql.join(
				source.schemas.map((slug) => sql`${slug}`),
				sql`, `,
			)})
			AND (${es}.user_id = ${userId} OR ${es}.user_id IS NULL)
		WHERE ${anchorColumn} = ${parent}.id
			AND (${r}.user_id = ${userId} OR ${r}.user_id IS NULL)
			AND (${e}.user_id = ${userId} OR ${e}.user_id IS NULL)
			${wherePushdownSql(subConditions)}
	`;
}

const compileExistsSql = (
	expr: Extract<Expr, { type: "exists" }>,
	ctx: PushdownCtx,
): SqlFragment | null => {
	const fromWhere = compileCorrelatedSubsource(expr.source, ctx);
	return fromWhere ? sql`EXISTS (SELECT 1 ${fromWhere})` : null;
};

// Correlated `aggregate` count compared to a numeric literal → a scalar `(SELECT COUNT(*) ...)`.
// COUNT(*) is never null, so ordering/equality against the literal matches the app-side compare;
// count-distinct and sum/avg/min/max stay app-side (their scalar/null handling differs).
const compileAggregateComparisonSql = (
	expr: Extract<Expr, { type: "comparison" }>,
	ctx: PushdownCtx,
): SqlFragment | null => {
	if (expr.operator === "neq") {
		return null;
	}
	const aggregate =
		expr.left.type === "aggregate"
			? expr.left
			: expr.right.type === "aggregate"
				? expr.right
				: null;
	const literal =
		expr.left.type === "literal" ? expr.left : expr.right.type === "literal" ? expr.right : null;
	if (!aggregate || !literal || literal.valueType === "date" || typeof literal.value !== "number") {
		return null;
	}
	if (
		aggregate.aggregation.function !== "count" ||
		aggregate.aggregation.distinctBy !== undefined
	) {
		return null;
	}
	const fromWhere = compileCorrelatedSubsource(aggregate.source, ctx);
	if (!fromWhere) {
		return null;
	}
	const scalar = sql`(SELECT COUNT(*) ${fromWhere})`;
	const op = COMPARISON_OP_SQL[expr.operator];
	return expr.left.type === "aggregate"
		? sql`(${scalar} ${op} ${literal.value})`
		: sql`(${literal.value} ${op} ${scalar})`;
};

// Returns null for anything not expressible with identical semantics (→ residual, evaluated
// app-side). Leaves are TRUE only when the app-side value is true, which composes under AND/OR;
// neq/not are excluded because SQL NULL negates unlike the app-side null-as-false rule. Correlated
// exists/aggregate compile only when the subquery capability is present.
function compileBoolExprToSql(expr: Expr, ctx: PushdownCtx): SqlFragment | null {
	if (expr.type === "comparison") {
		const aggregate = ctx.subquery ? compileAggregateComparisonSql(expr, ctx) : null;
		return aggregate ?? compileComparisonSql(expr, ctx.resolve);
	}
	if (expr.type === "contains") {
		return compileContainsSql(expr, ctx.resolve);
	}
	if (expr.type === "isNull" || expr.type === "isNotNull") {
		return compileNullCheckSql(expr, ctx.resolve);
	}
	if (expr.type === "exists") {
		return ctx.subquery ? compileExistsSql(expr, ctx) : null;
	}
	if (expr.type === "and" || expr.type === "or") {
		const parts: SqlFragment[] = [];
		for (const value of expr.values) {
			const compiled = compileBoolExprToSql(value, ctx);
			if (!compiled) {
				return null;
			}
			parts.push(compiled);
		}
		return sql`(${sql.join(parts, expr.type === "and" ? sql` AND ` : sql` OR `)})`;
	}
	return null;
}

// Splits a `where` into SQL conditions and an app-side residual, pushing top-level AND conjuncts
// independently. A null residual lets the caller apply SQL LIMIT and skip the app-side scan. Pass
// `subquery` (a userId) to also compile correlated exists/aggregate sub-sources into SQL.
export const wherePushdown = (
	where: Expr | null,
	resolve: WherePushdownResolve,
	subquery: { readonly userId: string } | null = null,
): WherePushdownResult => {
	if (!where) {
		return { conditions: [], residual: null };
	}
	let aliasCounter = 0;
	const ctx: PushdownCtx = {
		resolve,
		subquery: subquery ? { userId: subquery.userId, alloc: () => (aliasCounter += 1) } : null,
	};
	const conditions: SqlFragment[] = [];
	const residuals: Expr[] = [];
	for (const conjunct of flattenAndExpr(where)) {
		const compiled = compileBoolExprToSql(conjunct, ctx);
		if (compiled) {
			conditions.push(compiled);
		} else {
			residuals.push(conjunct);
		}
	}
	return { conditions, residual: nonEmptyAndExpr(residuals) };
};

export const entitySelectColumnsSql = sql`
	e.id,
	e.name,
	e.properties,
	e.created_at AS "createdAt",
	e.updated_at AS "updatedAt",
	e.external_id AS "externalId",
	e.user_id AS "userId",
	e.populated_at AS "populatedAt",
	e.sandbox_script_id AS "sandboxScriptId",
	es.id AS "schemaId",
	es.slug AS "schemaSlug",
	es.name AS "schemaName",
	es.is_builtin AS "schemaIsBuiltin"
`;

export const relationshipEdgeColumnsSql = sql`
	r.id AS "relationshipId",
	r.created_at AS "relationshipCreatedAt",
	r.source_entity_id AS "relationshipSourceEntityId",
	r.target_entity_id AS "relationshipTargetEntityId",
	r.properties AS "relationshipProperties",
	rs.slug AS "relationshipSchemaSlug",
	rs.name AS "relationshipSchemaName",
	rs.is_builtin AS "relationshipSchemaIsBuiltin"
`;

export const eventSelectColumnsSql = sql`
	ev.id AS "eventId",
	ev.properties AS "eventProperties",
	ev.entity_id AS "eventEntityId",
	ev.created_at AS "eventCreatedAt",
	ev.updated_at AS "eventUpdatedAt",
	ev.occurred_at AS "eventOccurredAt",
	ev.user_id AS "eventUserId",
	ev.session_entity_id AS "eventSessionEntityId",
	evs.id AS "eventSchemaId",
	evs.slug AS "eventSchemaSlug",
	evs.name AS "eventSchemaName",
	evs.is_builtin AS "eventSchemaIsBuiltin"
`;

export const entityJsonbObjectSql = (entityAlias: string, schemaAlias: string) => sql`
	jsonb_build_object(
		'id', ${sql.raw(entityAlias)}.id,
		'name', ${sql.raw(entityAlias)}.name,
		'createdAt', ${sql.raw(entityAlias)}.created_at,
		'updatedAt', ${sql.raw(entityAlias)}.updated_at,
		'properties', ${sql.raw(entityAlias)}.properties,
		'externalId', ${sql.raw(entityAlias)}.external_id,
		'userId', ${sql.raw(entityAlias)}.user_id,
		'populatedAt', ${sql.raw(entityAlias)}.populated_at,
		'sandboxScriptId', ${sql.raw(entityAlias)}.sandbox_script_id,
		'schemaId', ${sql.raw(schemaAlias)}.id,
		'schemaSlug', ${sql.raw(schemaAlias)}.slug,
		'schemaName', ${sql.raw(schemaAlias)}.name,
		'schemaIsBuiltin', ${sql.raw(schemaAlias)}.is_builtin
	)
`;

// Root row-producing FROM + WHERE fragments (visibility enforced), shared by the row/candidate
// scans and by the aggregate / time-series SQL pushdown. Callers pass the visible-schema id
// fragments (already resolved through the schema loaders) and any pushed where conditions.
export const entityRootFromWhereSql = (
	schemaIdsSql: SqlFragment,
	userId: string,
	pushedConditions: readonly SqlFragment[] = [],
) => sql`
	FROM entity e
	JOIN entity_schema es ON es.id = e.entity_schema_id
	WHERE
		e.entity_schema_id IN (${schemaIdsSql})
		AND (e.user_id = ${userId} OR e.user_id IS NULL)
		${wherePushdownSql(pushedConditions)}
`;

export const eventRootFromWhereSql = (
	eventSchemaIdsSql: SqlFragment,
	entitySchemaIdsSql: SqlFragment,
	userId: string,
	pushedConditions: readonly SqlFragment[] = [],
) => sql`
	FROM event ev
	JOIN event_schema evs ON evs.id = ev.event_schema_id
	JOIN entity e ON e.id = ev.entity_id
	JOIN entity_schema es ON es.id = e.entity_schema_id
	WHERE
		ev.user_id = ${userId}
		AND ev.event_schema_id IN (${eventSchemaIdsSql})
		AND e.entity_schema_id IN (${entitySchemaIdsSql})
		AND (e.user_id = ${userId} OR e.user_id IS NULL)
		${wherePushdownSql(pushedConditions)}
`;

export const relationshipRootFromWhereSql = (
	relationshipSchemaIdsSql: SqlFragment,
	sourceEntitySchemaIdsSql: SqlFragment,
	targetEntitySchemaIdsSql: SqlFragment,
	userId: string,
	pushedConditions: readonly SqlFragment[] = [],
) => sql`
	FROM relationship r
	JOIN relationship_schema rs ON rs.id = r.relationship_schema_id
	JOIN entity se ON se.id = r.source_entity_id
	JOIN entity_schema ses ON ses.id = se.entity_schema_id
	JOIN entity te ON te.id = r.target_entity_id
	JOIN entity_schema tes ON tes.id = te.entity_schema_id
	WHERE
		r.relationship_schema_id IN (${relationshipSchemaIdsSql})
		AND se.entity_schema_id IN (${sourceEntitySchemaIdsSql})
		AND te.entity_schema_id IN (${targetEntitySchemaIdsSql})
		AND (r.user_id = ${userId} OR r.user_id IS NULL)
		AND (se.user_id = ${userId} OR se.user_id IS NULL)
		AND (te.user_id = ${userId} OR te.user_id IS NULL)
		${wherePushdownSql(pushedConditions)}
`;

export const relationshipRootSelectSql = (
	relationshipSchemaIdsSql: ReturnType<typeof sql>,
	sourceEntitySchemaIdsSql: ReturnType<typeof sql>,
	targetEntitySchemaIdsSql: ReturnType<typeof sql>,
	userId: string,
	pushedConditions: readonly SqlFragment[] = [],
) => sql`
	SELECT
		r.id AS "relationshipId",
		r.created_at AS "relationshipCreatedAt",
		r.source_entity_id AS "relationshipSourceEntityId",
		r.target_entity_id AS "relationshipTargetEntityId",
		r.properties AS "relationshipProperties",
		rs.slug AS "relationshipSchemaSlug",
		rs.name AS "relationshipSchemaName",
		rs.is_builtin AS "relationshipSchemaIsBuiltin",
		${entityJsonbObjectSql("se", "ses")} AS "sourceEntity",
		${entityJsonbObjectSql("te", "tes")} AS "targetEntity",
		COUNT(*) OVER() AS "totalCount"
	${relationshipRootFromWhereSql(relationshipSchemaIdsSql, sourceEntitySchemaIdsSql, targetEntitySchemaIdsSql, userId, pushedConditions)}
`;

export const includeOrderSql = (source: EntitySource, orderBy: IncludeEntry["orderBy"]) =>
	buildOrderBySql(orderBy, (ref) => ({
		schemas: source.schemas,
		alias: ref.sourceAlias === source.via?.alias ? "r" : "e",
	}));

export const eventIncludeOrderSql = (source: NestedEventSource, orderBy: IncludeEntry["orderBy"]) =>
	buildOrderBySql(orderBy, (ref) => ({
		schemas: source.schemas,
		alias: ref.sourceAlias === source.alias ? "ev" : "e",
	}));

export const relationshipRootOrderSql = (source: RelationshipSource, output: RowsOutput) =>
	buildOrderBySql(output.orderBy, (ref) =>
		ref.sourceAlias === source.alias
			? { alias: "r", schemas: source.schemas }
			: ref.sourceAlias === source.sourceEntity.alias
				? { alias: "se", schemas: source.sourceEntity.schemas }
				: ref.sourceAlias === source.targetEntity.alias
					? { alias: "te", schemas: source.targetEntity.schemas }
					: null,
	);

export const relationshipRootWherePushdown = (
	source: RelationshipSource,
	userId: string,
): WherePushdownResult =>
	wherePushdown(
		source.where,
		(ref) =>
			ref.sourceAlias === source.alias
				? { alias: "r", schemas: source.schemas }
				: ref.sourceAlias === source.sourceEntity.alias
					? { alias: "se", schemas: source.sourceEntity.schemas }
					: ref.sourceAlias === source.targetEntity.alias
						? { alias: "te", schemas: source.targetEntity.schemas }
						: null,
		{ userId },
	);

export const eventRootOrderSql = (source: RootEventSource, output: RowsOutput) =>
	buildOrderBySql(output.orderBy, (ref) =>
		ref.sourceAlias === source.alias
			? { alias: "ev", schemas: source.schemas }
			: { alias: "e", schemas: source.entity.schemas },
	);

// --- Aggregate / time-series SQL pushdown helpers ---
//
// These map root-source refs onto the SQL aliases produced by the *RootFromWhereSql builders
// (entity `e`/`es`, event `ev`/`evs`, relationship `r`/`rs` plus endpoint entities `se`/`ses`,
// `te`/`tes`) so grouping, aggregation and time bucketing can run in the database.

export type RootAliasTarget = {
	readonly kind: RootAliasKind;
	readonly sqlAlias: string;
	readonly schemas: readonly string[];
};
export type RootAliasResolve = (sourceAlias: string) => RootAliasTarget | null;

export const rootAliasResolver = (source: RootSource): RootAliasResolve => {
	if (source.type === "entities") {
		return (alias) =>
			alias === source.alias ? { kind: "entity", sqlAlias: "e", schemas: source.schemas } : null;
	}
	if (source.type === "events") {
		return (alias) =>
			alias === source.alias
				? { kind: "event", sqlAlias: "ev", schemas: source.schemas }
				: alias === source.entity.alias
					? { kind: "entity", sqlAlias: "e", schemas: source.entity.schemas }
					: null;
	}
	return (alias) =>
		alias === source.alias
			? { kind: "relationship", sqlAlias: "r", schemas: source.schemas }
			: alias === source.sourceEntity.alias
				? { kind: "entity", sqlAlias: "se", schemas: source.sourceEntity.schemas }
				: alias === source.targetEntity.alias
					? { kind: "entity", sqlAlias: "te", schemas: source.targetEntity.schemas }
					: null;
};

export const rootWherePushdown = (source: RootSource, userId: string): WherePushdownResult => {
	const resolve = rootAliasResolver(source);
	return wherePushdown(
		source.where,
		(ref) => {
			const target = resolve(ref.sourceAlias);
			return target ? { alias: target.sqlAlias, schemas: target.schemas } : null;
		},
		{ userId },
	);
};

// Returns the SQL for a groupBy field selector, or null when it is not expressible with identical
// semantics (grouping by the whole `properties` json object stays app-side).
export const groupFieldSql = (
	field: FieldSelector,
	target: RootAliasTarget,
): SqlFragment | null => {
	if (field.type === "system") {
		// `properties` (whole json) and timestamp columns stay app-side: Postgres groups a timestamptz
		// at microsecond precision, but the app-side path keys off the driver's millisecond-truncated
		// JS Date, so microsecond-distinct rows would split into separate SQL groups.
		return field.name === "properties" || SYSTEM_DATE_FIELDS_BY_KIND[target.kind].has(field.name)
			? null
			: systemFieldSql(field.name, target.sqlAlias);
	}

	const schemaTable = sql.raw(`${target.sqlAlias}s`);
	if (field.type === "schema") {
		return field.name === "slug"
			? sql`${schemaTable}.slug`
			: field.name === "isBuiltin"
				? sql`${schemaTable}.is_builtin`
				: sql`${schemaTable}.name`;
	}

	const extract = propertyExtractSql(target.sqlAlias, field.path);
	const guarded =
		target.schemas.length > 1
			? sql`CASE WHEN ${schemaTable}.slug = ${field.schema} THEN ${extract} END`
			: extract;
	// Normalize JSON null to SQL NULL so JSON-null and missing keys land in one group (as app-side does).
	return sql`nullif(${guarded}, 'null'::jsonb)`;
};

// Only JSON numbers contribute to sum/avg/min/max (matching the app-side numeric filter); non-number
// and wrong-schema rows read as NULL and are ignored by the SQL aggregate.
const numericPropertyOperandSql = (
	field: Extract<FieldSelector, { type: "property" }>,
	target: RootAliasTarget,
): SqlFragment => {
	const extract = propertyExtractSql(target.sqlAlias, field.path);
	const extractText = propertyExtractTextSql(target.sqlAlias, field.path);
	const slugGuard =
		target.schemas.length > 1
			? sql`${sql.raw(`${target.sqlAlias}s`)}.slug = ${field.schema}`
			: null;
	const guards = [slugGuard, sql`jsonb_typeof(${extract}) = 'number'`].filter(isSqlFragment);
	return sql`(CASE WHEN ${sql.join(guards, sql` AND `)} THEN (${extractText})::double precision END)`;
};

const AGGREGATE_FN_SQL: Record<"sum" | "average" | "minimum" | "maximum", string> = {
	sum: "SUM",
	average: "AVG",
	minimum: "MIN",
	maximum: "MAX",
};

// Returns the SQL aggregate for a measure, or null when it cannot match app-side semantics
// (count-distinct and non-numeric-property operands stay app-side). Numeric aggregates cast to
// double precision so results match JS float arithmetic; over an empty numeric set they yield NULL.
export const measureAggregationSql = (
	aggregation: AggregationSpec,
	resolve: RootAliasResolve,
): SqlFragment | null => {
	if (aggregation.function === "count") {
		return aggregation.distinctBy === undefined ? sql`COUNT(*)` : null;
	}
	const operand = aggregation.expr;
	if (operand.type !== "ref" || operand.field.type !== "property") {
		return null;
	}
	const target = resolve(operand.sourceAlias);
	if (!target) {
		return null;
	}
	return sql`${sql.raw(AGGREGATE_FN_SQL[aggregation.function])}(${numericPropertyOperandSql(operand.field, target)})`;
};

// Orders grouped output by measure aliases (m0, m1, ...). Postgres defaults (ASC NULLS LAST,
// DESC NULLS FIRST) match the app-side null ordering. Returns null if an orderBy entry is not a
// resolvable measureRef.
export const aggregateOrderBySql = (
	orderBy: readonly { readonly order: "asc" | "desc"; readonly expr: Expr }[],
	measureKeyToIndex: ReadonlyMap<string, number>,
): SqlFragment | null => {
	const parts: SqlFragment[] = [];
	for (const entry of orderBy) {
		if (entry.expr.type !== "measureRef") {
			continue;
		}
		const index = measureKeyToIndex.get(entry.expr.key);
		if (index === undefined) {
			return null;
		}
		parts.push(sql`${sql.raw(`"m${index}"`)} ${entry.order === "asc" ? sql`ASC` : sql`DESC`}`);
	}
	return parts.length === 0 ? null : sql.join(parts, sql`, `);
};

// UTC, ISO/Monday-start weeks: Postgres date_trunc('week') is Monday-based like the app-side
// bucketing, and the AT TIME ZONE 'UTC' sandwich truncates on UTC boundaries regardless of session
// time zone while returning a timestamptz.
export const timeBucketSql = (
	bucket: TimeSeriesOutput["time"]["bucket"],
	timeColSql: SqlFragment,
): SqlFragment => sql`date_trunc(${bucket}, ${timeColSql} AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`;

export const timeRangeConditionSql = (
	timeColSql: SqlFragment,
	startAt: string,
	endAt: string,
): SqlFragment =>
	sql`(${timeColSql} >= ${startAt}::timestamptz AND ${timeColSql} < ${endAt}::timestamptz)`;

// The timestamptz column for a system date field, or null for any other time expression. Property
// and computed time expressions keep the app-side path (their string parsing is more lenient than
// a SQL ::timestamptz cast, which would drift or error on non-ISO values).
export const timeColumnSql = (field: FieldSelector, target: RootAliasTarget): SqlFragment | null =>
	field.type === "system" && SYSTEM_DATE_FIELDS_BY_KIND[target.kind].has(field.name)
		? systemFieldSql(field.name, target.sqlAlias)
		: null;
