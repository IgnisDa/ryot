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

export const systemFieldSql = (name: string, alias = "e"): ReturnType<typeof sql> | null => {
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
		image: sql`${table}.image`,
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

export const entitySelectColumnsSql = sql`
	e.id,
	e.name,
	e.image,
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
		'image', ${sql.raw(entityAlias)}.image,
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
