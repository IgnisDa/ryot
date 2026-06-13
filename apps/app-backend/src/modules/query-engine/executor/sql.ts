import { sql } from "drizzle-orm";

import type {
	EntitySource,
	Expr,
	FieldSelector,
	IncludeEntry,
	NestedEventSource,
	RelationshipSource,
	RootEventSource,
	RowsOutput,
} from "../language";

const systemFieldSql = (name: string, alias = "e"): ReturnType<typeof sql> | null => {
	if (alias === "ev") {
		const eventColumnMap: Record<string, ReturnType<typeof sql>> = {
			id: sql`ev.id`,
			userId: sql`ev.user_id`,
			entityId: sql`ev.entity_id`,
			createdAt: sql`ev.created_at`,
			updatedAt: sql`ev.updated_at`,
			properties: sql`ev.properties`,
			occurredAt: sql`ev.occurred_at`,
			eventSchemaId: sql`ev.event_schema_id`,
			sessionEntityId: sql`ev.session_entity_id`,
		};
		return eventColumnMap[name] ?? null;
	}

	if (alias === "r") {
		const relationshipColumnMap: Record<string, ReturnType<typeof sql>> = {
			id: sql`r.id`,
			createdAt: sql`r.created_at`,
			sourceEntityId: sql`r.source_entity_id`,
			targetEntityId: sql`r.target_entity_id`,
		};
		return relationshipColumnMap[name] ?? null;
	}

	const table = sql.raw(alias);
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

// Text columns only; timestamp/jsonb columns compare differently app-side, so they stay residual.
const TEXT_SYSTEM_FIELDS_BY_ALIAS: Record<string, ReadonlySet<string>> = {
	e: new Set(["id", "name", "userId", "externalId", "sandboxScriptId"]),
	ev: new Set(["id", "userId", "entityId", "sessionEntityId"]),
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

// Returns null for anything not expressible with identical semantics (→ residual, evaluated
// app-side). Leaves are TRUE only when the app-side value is true, which composes under AND/OR;
// neq/not are excluded because SQL NULL negates unlike the app-side null-as-false rule.
const compileBoolExprToSql = (expr: Expr, resolve: WherePushdownResolve): SqlFragment | null => {
	if (expr.type === "comparison") {
		return compileComparisonSql(expr, resolve);
	}
	if (expr.type === "contains") {
		return compileContainsSql(expr, resolve);
	}
	if (expr.type === "isNull" || expr.type === "isNotNull") {
		return compileNullCheckSql(expr, resolve);
	}
	if (expr.type === "and" || expr.type === "or") {
		const parts: SqlFragment[] = [];
		for (const value of expr.values) {
			const compiled = compileBoolExprToSql(value, resolve);
			if (!compiled) {
				return null;
			}
			parts.push(compiled);
		}
		return sql`(${sql.join(parts, expr.type === "and" ? sql` AND ` : sql` OR `)})`;
	}
	return null;
};

const flattenAndExpr = (expr: Expr): Expr[] =>
	expr.type === "and" ? expr.values.flatMap(flattenAndExpr) : [expr];

// Splits a `where` into SQL conditions and an app-side residual, pushing top-level AND conjuncts
// independently. A null residual lets the caller apply SQL LIMIT and skip the app-side scan.
export const wherePushdown = (
	where: Expr | null,
	resolve: WherePushdownResolve,
): WherePushdownResult => {
	if (!where) {
		return { conditions: [], residual: null };
	}
	const conditions: SqlFragment[] = [];
	const residuals: Expr[] = [];
	for (const conjunct of flattenAndExpr(where)) {
		const compiled = compileBoolExprToSql(conjunct, resolve);
		if (compiled) {
			conditions.push(compiled);
		} else {
			residuals.push(conjunct);
		}
	}
	return { conditions, residual: nonEmptyAndExpr(residuals) };
};

export const wherePushdownSql = (conditions: readonly SqlFragment[]) =>
	conditions.length > 0 ? sql`AND ${sql.join([...conditions], sql` AND `)}` : sql``;

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

export const relationshipRootSelectSql = (
	relationshipSchemaIdsSql: ReturnType<typeof sql>,
	sourceEntitySchemaIdsSql: ReturnType<typeof sql>,
	targetEntitySchemaIdsSql: ReturnType<typeof sql>,
	userId: string,
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

export const eventRootOrderSql = (source: RootEventSource, output: RowsOutput) =>
	buildOrderBySql(output.orderBy, (ref) =>
		ref.sourceAlias === source.alias
			? { alias: "ev", schemas: source.schemas }
			: { alias: "e", schemas: source.entity.schemas },
	);
