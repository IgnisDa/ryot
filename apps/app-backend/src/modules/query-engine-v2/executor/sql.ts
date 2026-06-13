import { sql } from "drizzle-orm";

import type {
	Expr,
	FieldSelector,
	IncludeEntryV2,
	RelationshipSourceV2,
	RootEventSourceV2,
	RowsOutputV2,
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

	const columnMap: Record<string, ReturnType<typeof sql>> = {
		id: sql`e.id`,
		name: sql`e.name`,
		image: sql`e.image`,
		createdAt: sql`e.created_at`,
		updatedAt: sql`e.updated_at`,
		externalId: sql`e.external_id`,
		sandboxScriptId: sql`e.sandbox_script_id`,
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

	if (field.type === "property") {
		const pathArgs = field.path.map((key) => sql`${key}`);
		const propertiesExpr =
			alias === "r" ? sql`r.properties` : alias === "ev" ? sql`ev.properties` : sql`e.properties`;
		const jsonbExpr = sql`jsonb_extract_path_text(${propertiesExpr}, ${sql.join(pathArgs, sql`, `)})`;

		if (alias === "r" || sourceSchemas.length === 1) {
			return jsonbExpr;
		}

		const schemaSlugExpr = alias === "ev" ? sql`evs.slug` : sql`es.slug`;
		return sql`CASE WHEN ${schemaSlugExpr} = ${field.schema} THEN ${jsonbExpr} END`;
	}

	if (alias === "r") {
		return field.name === "slug" ? sql`rs.slug` : sql`rs.name`;
	}
	if (alias === "ev") {
		return field.name === "slug" ? sql`evs.slug` : sql`evs.name`;
	}
	return field.name === "slug" ? sql`es.slug` : sql`es.name`;
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
		'schemaName', ${sql.raw(schemaAlias)}.name
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

export const includeOrderSql = (include: IncludeEntryV2): ReturnType<typeof sql> => {
	const viaAlias = include.source.via?.alias;
	const orderParts = include.orderBy.map((entry) => {
		if (entry.expr.type !== "ref") {
			return sql`1`;
		}

		const sourceAlias = entry.expr.sourceAlias === viaAlias ? "r" : "e";
		const exprSql = fieldSelectorToOrderSql(entry.expr.field, include.source.schemas, sourceAlias);
		if (!exprSql) {
			return sql`1`;
		}
		return entry.order === "asc" ? sql`${exprSql} ASC` : sql`${exprSql} DESC`;
	});
	return sql.join(orderParts, sql`, `);
};

export const relationshipRootOrderSql = (source: RelationshipSourceV2, output: RowsOutputV2) => {
	const orderParts = output.orderBy.map((entry) => {
		if (entry.expr.type !== "ref" || entry.expr.sourceAlias !== source.alias) {
			return sql`1`;
		}
		const exprSql = fieldSelectorToOrderSql(entry.expr.field, source.schemas, "r");
		if (!exprSql) {
			return sql`1`;
		}
		return entry.order === "asc" ? sql`${exprSql} ASC` : sql`${exprSql} DESC`;
	});
	return sql.join(orderParts, sql`, `);
};

export const eventRootOrderSql = (source: RootEventSourceV2, output: RowsOutputV2) => {
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
