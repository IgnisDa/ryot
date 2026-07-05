import type { RelationshipSource, RootSource } from "@ryot/contract/modules/query-engine/language";
import { sql } from "drizzle-orm";
import { Effect } from "effect";

import { entitySourceSql } from "./compile/fragments";
import {
	loadVisibleEntitySchemas,
	loadVisibleEventSchemasForEntitySchemas,
	loadVisibleRelationshipSchemas,
} from "./schema-loaders";

type SqlFragment = ReturnType<typeof sql>;

const andConditionsSql = (conditions: readonly SqlFragment[]) =>
	conditions.length > 0 ? sql`AND ${sql.join([...conditions], sql` AND `)}` : sql``;

// Root row-producing FROM + WHERE fragments, with per-user visibility enforced. Callers pass the
// visible-schema id fragments and any compiled where conditions.
const entityRootFromWhereSql = (
	schemas: readonly { id: string; slug: string; name: string; isBuiltin: boolean }[],
	userId: string,
	language: string | null,
	pushedConditions: readonly SqlFragment[],
) => sql`
	FROM ${entitySourceSql(language)} e
	JOIN (VALUES ${sql.join(
		schemas.map((schema) => sql`(${schema.slug}, ${schema.name}, ${schema.isBuiltin}::boolean)`),
		sql`, `,
	)}) AS es(slug, name, is_builtin) ON es.slug = e.entity_schema_slug
	WHERE
		e.entity_schema_slug IN (${idListSql(schemas)})
		AND (e.user_id = ${userId} OR e.user_id IS NULL)
		${andConditionsSql(pushedConditions)}
`;

const eventRootFromWhereSql = (
	eventSchemaSlugsSql: SqlFragment,
	entitySchemaSlugsSql: SqlFragment,
	userId: string,
	language: string | null,
	pushedConditions: readonly SqlFragment[],
) => sql`
	FROM event ev
	JOIN ${entitySourceSql(language)} e ON e.id = ev.entity_id
	WHERE
		ev.user_id = ${userId}
		AND ev.event_schema_slug IN (${eventSchemaSlugsSql})
		AND e.entity_schema_slug IN (${entitySchemaSlugsSql})
		AND (e.user_id = ${userId} OR e.user_id IS NULL)
		${andConditionsSql(pushedConditions)}
`;

const relationshipRootFromWhereSql = (
	relationshipSchemaSlugsSql: SqlFragment,
	sourceEntitySchemaSlugsSql: SqlFragment,
	targetEntitySchemaSlugsSql: SqlFragment,
	userId: string,
	language: string | null,
	pushedConditions: readonly SqlFragment[],
) => sql`
	FROM relationship r
	JOIN ${entitySourceSql(language)} se ON se.id = r.source_entity_id
	JOIN ${entitySourceSql(language)} te ON te.id = r.target_entity_id
	WHERE
		r.relationship_schema_slug IN (${relationshipSchemaSlugsSql})
		AND se.entity_schema_slug IN (${sourceEntitySchemaSlugsSql})
		AND te.entity_schema_slug IN (${targetEntitySchemaSlugsSql})
		AND (r.user_id = ${userId} OR r.user_id IS NULL)
		AND (se.user_id = ${userId} OR se.user_id IS NULL)
		AND (te.user_id = ${userId} OR te.user_id IS NULL)
		${andConditionsSql(pushedConditions)}
`;

export const loadRelationshipRootVisibleSchemas = (userId: string, source: RelationshipSource) =>
	Effect.all(
		[
			loadVisibleRelationshipSchemas(userId, source.schemas),
			loadVisibleEntitySchemas(userId, source.sourceEntity.schemas),
			loadVisibleEntitySchemas(userId, source.targetEntity.schemas),
		],
		{ concurrency: 1 },
	);

const idListSql = (schemas: readonly { id: string }[]) =>
	sql.join(
		schemas.map((schema) => sql`${schema.id}`),
		sql`, `,
	);

// Resolves a root source's visible schemas and returns its FROM + WHERE fragment (visibility
// enforced, pushed conditions applied). Shared by the aggregate and time-series SQL paths.
export const rootSourceFromWhereSql = Effect.fn("rootSourceFromWhereSql")(function* (
	userId: string,
	language: string | null,
	source: RootSource,
	pushedConditions: readonly SqlFragment[],
) {
	if (source.type === "entities") {
		const visible = yield* loadVisibleEntitySchemas(userId, source.schemas);
		return entityRootFromWhereSql(visible, userId, language, pushedConditions);
	}
	if (source.type === "events") {
		const visibleEntitySchemas = yield* loadVisibleEntitySchemas(userId, source.entity.schemas);
		const entitySchemaSlugs = visibleEntitySchemas.map((schema) => schema.id);
		const visibleEventSchemas = yield* loadVisibleEventSchemasForEntitySchemas(
			userId,
			entitySchemaSlugs,
			source.schemas,
		);
		return eventRootFromWhereSql(
			idListSql(visibleEventSchemas),
			sql.join(
				entitySchemaSlugs.map((id) => sql`${id}`),
				sql`, `,
			),
			userId,
			language,
			pushedConditions,
		);
	}
	const [visibleRelationshipSchemas, visibleSourceEntitySchemas, visibleTargetEntitySchemas] =
		yield* loadRelationshipRootVisibleSchemas(userId, source);
	return relationshipRootFromWhereSql(
		idListSql(visibleRelationshipSchemas),
		idListSql(visibleSourceEntitySchemas),
		idListSql(visibleTargetEntitySchemas),
		userId,
		language,
		pushedConditions,
	);
});
