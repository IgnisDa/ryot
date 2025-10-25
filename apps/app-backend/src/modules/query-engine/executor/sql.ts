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
			createdAt: sql`ev.created_at`,
			updatedAt: sql`ev.updated_at`,
			occurredAt: sql`ev.occurred_at`,
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
		createdAt: sql`${table}.created_at`,
		updatedAt: sql`${table}.updated_at`,
		externalId: sql`${table}.external_id`,
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
		const jsonbExpr = sql`jsonb_extract_path_text(${propertiesExpr}, ${sql.join(pathArgs, sql`, `)})`;

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

export const exprToOrderSql = (
	expr: Expr,
	sourceSchemas: readonly [string, ...string[]],
): ReturnType<typeof sql> | null => {
	if (expr.type !== "ref") {
		return null;
	}
	return fieldSelectorToOrderSql(expr.field, sourceSchemas);
};

export const entityJsonbObjectSql = (entityAlias: string, schemaAlias: string) => sql`
	jsonb_build_object(
		'id', ${sql.raw(entityAlias)}.id,
		'name', ${sql.raw(entityAlias)}.name,
		'image', ${sql.raw(entityAlias)}.image,
		'createdAt', ${sql.raw(entityAlias)}.created_at,
		'updatedAt', ${sql.raw(entityAlias)}.updated_at,
		'properties', ${sql.raw(entityAlias)}.properties,
		'externalId', ${sql.raw(entityAlias)}.external_id,
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

export const includeOrderSql = (
	source: EntitySource,
	orderBy: IncludeEntry["orderBy"],
): ReturnType<typeof sql> => {
	const viaAlias = source.via?.alias;
	const orderParts = orderBy.map((entry) => {
		if (entry.expr.type !== "ref") {
			return sql`1`;
		}

		const sourceAlias = entry.expr.sourceAlias === viaAlias ? "r" : "e";
		const exprSql = fieldSelectorToOrderSql(entry.expr.field, source.schemas, sourceAlias);
		if (!exprSql) {
			return sql`1`;
		}
		return entry.order === "asc" ? sql`${exprSql} ASC` : sql`${exprSql} DESC`;
	});
	return sql.join(orderParts, sql`, `);
};

export const eventIncludeOrderSql = (
	source: NestedEventSource,
	orderBy: IncludeEntry["orderBy"],
): ReturnType<typeof sql> => {
	const orderParts = orderBy.map((entry) => {
		if (entry.expr.type !== "ref") {
			return sql`1`;
		}

		const alias = entry.expr.sourceAlias === source.alias ? "ev" : "e";
		const exprSql = fieldSelectorToOrderSql(entry.expr.field, source.schemas, alias);
		if (!exprSql) {
			return sql`1`;
		}
		return entry.order === "asc" ? sql`${exprSql} ASC` : sql`${exprSql} DESC`;
	});
	return sql.join(orderParts, sql`, `);
};

export const relationshipRootOrderSql = (source: RelationshipSource, output: RowsOutput) => {
	const orderParts = output.orderBy.map((entry) => {
		if (entry.expr.type !== "ref") {
			return sql`1`;
		}
		const target =
			entry.expr.sourceAlias === source.alias
				? { alias: "r", schemas: source.schemas }
				: entry.expr.sourceAlias === source.sourceEntity.alias
					? { alias: "se", schemas: source.sourceEntity.schemas }
					: entry.expr.sourceAlias === source.targetEntity.alias
						? { alias: "te", schemas: source.targetEntity.schemas }
						: null;
		if (!target) {
			return sql`1`;
		}
		const exprSql = fieldSelectorToOrderSql(entry.expr.field, target.schemas, target.alias);
		if (!exprSql) {
			return sql`1`;
		}
		return entry.order === "asc" ? sql`${exprSql} ASC` : sql`${exprSql} DESC`;
	});
	return sql.join(orderParts, sql`, `);
};

export const eventRootOrderSql = (source: RootEventSource, output: RowsOutput) => {
	const orderParts = output.orderBy.map((entry) => {
		if (entry.expr.type !== "ref") {
			return sql`1`;
		}

		const alias = entry.expr.sourceAlias === source.alias ? "ev" : "e";
		const schemas = alias === "ev" ? source.schemas : source.entity.schemas;
		const exprSql = fieldSelectorToOrderSql(entry.expr.field, schemas, alias);
		if (!exprSql) {
			return sql`1`;
		}
		return entry.order === "asc" ? sql`${exprSql} ASC` : sql`${exprSql} DESC`;
	});
	return sql.join(orderParts, sql`, `);
};
