import { sql } from "drizzle-orm";
import { Effect } from "effect";

import type { RelationshipSource, RootSource } from "../language";
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
	schemaIdsSql: SqlFragment,
	userId: string,
	language: string | null,
	pushedConditions: readonly SqlFragment[],
) => sql`
	FROM ${entitySourceSql(language)} e
	JOIN entity_schema es ON es.id = e.entity_schema_id
	WHERE
		e.entity_schema_id IN (${schemaIdsSql})
		AND (e.user_id = ${userId} OR e.user_id IS NULL)
		${andConditionsSql(pushedConditions)}
`;

const eventRootFromWhereSql = (
	eventSchemaIdsSql: SqlFragment,
	entitySchemaIdsSql: SqlFragment,
	userId: string,
	language: string | null,
	pushedConditions: readonly SqlFragment[],
) => sql`
	FROM event ev
	JOIN event_schema evs ON evs.id = ev.event_schema_id
	JOIN ${entitySourceSql(language)} e ON e.id = ev.entity_id
	JOIN entity_schema es ON es.id = e.entity_schema_id
	WHERE
		ev.user_id = ${userId}
		AND ev.event_schema_id IN (${eventSchemaIdsSql})
		AND e.entity_schema_id IN (${entitySchemaIdsSql})
		AND (e.user_id = ${userId} OR e.user_id IS NULL)
		${andConditionsSql(pushedConditions)}
`;

const relationshipRootFromWhereSql = (
	relationshipSchemaIdsSql: SqlFragment,
	sourceEntitySchemaIdsSql: SqlFragment,
	targetEntitySchemaIdsSql: SqlFragment,
	userId: string,
	language: string | null,
	pushedConditions: readonly SqlFragment[],
) => sql`
	FROM relationship r
	JOIN relationship_schema rs ON rs.id = r.relationship_schema_id
	JOIN ${entitySourceSql(language)} se ON se.id = r.source_entity_id
	JOIN entity_schema ses ON ses.id = se.entity_schema_id
	JOIN ${entitySourceSql(language)} te ON te.id = r.target_entity_id
	JOIN entity_schema tes ON tes.id = te.entity_schema_id
	WHERE
		r.relationship_schema_id IN (${relationshipSchemaIdsSql})
		AND se.entity_schema_id IN (${sourceEntitySchemaIdsSql})
		AND te.entity_schema_id IN (${targetEntitySchemaIdsSql})
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
		{ concurrency: "unbounded" },
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
		return entityRootFromWhereSql(idListSql(visible), userId, language, pushedConditions);
	}
	if (source.type === "events") {
		const visibleEntitySchemas = yield* loadVisibleEntitySchemas(userId, source.entity.schemas);
		const entitySchemaIds = visibleEntitySchemas.map((schema) => schema.id);
		const visibleEventSchemas = yield* loadVisibleEventSchemasForEntitySchemas(
			userId,
			entitySchemaIds,
			source.schemas,
		);
		return eventRootFromWhereSql(
			idListSql(visibleEventSchemas),
			sql.join(
				entitySchemaIds.map((id) => sql`${id}`),
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
