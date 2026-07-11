import type { RelationshipSource, RootSource } from "@ryot/contract/modules/query-engine/language";
import { sql } from "drizzle-orm";
import { Effect } from "effect";

import type { QueryExecutionScope } from "../execution-scope";
import { entitySourceSql, rowVisibleSql } from "./compile/fragments";
import {
	loadVisibleEntitySchemas,
	loadVisibleEventSchemasForEntitySchemas,
	loadRelationshipEndpointEntitySchemas,
	loadVisibleRelationshipSchemas,
} from "./schema-loaders";

type SqlFragment = ReturnType<typeof sql>;

const andConditionsSql = (conditions: readonly SqlFragment[]) =>
	conditions.length > 0 ? sql`AND ${sql.join([...conditions], sql` AND `)}` : sql``;

// Root row-producing FROM + WHERE fragments, with per-user visibility enforced. Callers pass the
// visible-schema id fragments and any compiled where conditions.
const entityRootFromWhereSql = (
	schemas: readonly { id: string; slug: string; name: string }[],
	executionScope: QueryExecutionScope,
	language: string | null,
	pushedConditions: readonly SqlFragment[],
) => sql`
	FROM ${entitySourceSql(language)} e
	JOIN (VALUES ${sql.join(
		schemas.map((schema) => sql`(${schema.slug}, ${schema.name})`),
		sql`, `,
	)}) AS es(slug, name) ON es.slug = e.entity_schema_slug
	WHERE
		e.entity_schema_slug IN (${idListSql(schemas)})
		AND ${rowVisibleSql("entity", "e", executionScope)}
		${andConditionsSql(pushedConditions)}
`;

const eventRootFromWhereSql = (
	eventSchemaSlugsSql: SqlFragment,
	entitySchemaSlugsSql: SqlFragment,
	executionScope: QueryExecutionScope,
	language: string | null,
	pushedConditions: readonly SqlFragment[],
) => sql`
	FROM event ev
	JOIN ${entitySourceSql(language)} e ON e.id = ev.entity_id
	WHERE
		${rowVisibleSql("event", "ev", executionScope)}
		AND ev.event_schema_slug IN (${eventSchemaSlugsSql})
		AND e.entity_schema_slug IN (${entitySchemaSlugsSql})
		AND ${rowVisibleSql("entity", "e", executionScope)}
		${andConditionsSql(pushedConditions)}
`;

const relationshipRootFromWhereSql = (
	relationshipSchemaSlugs: readonly string[],
	relationshipSchemaSlugsSql: SqlFragment,
	sourceEntitySchemaSlugsSql: SqlFragment,
	targetEntitySchemaSlugsSql: SqlFragment,
	executionScope: QueryExecutionScope,
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
		AND ${rowVisibleSql("relationship", "r", executionScope)}
		AND ${rowVisibleSql("entity", "se", executionScope, {
			type: "relationshipEndpoint",
			endpoint: "source",
			relationshipSchemaSlugs,
		})}
		AND ${rowVisibleSql("entity", "te", executionScope, {
			type: "relationshipEndpoint",
			endpoint: "target",
			relationshipSchemaSlugs,
		})}
		${andConditionsSql(pushedConditions)}
`;

export const loadRelationshipRootVisibleSchemas = (
	executionScope: QueryExecutionScope,
	source: RelationshipSource,
) =>
	Effect.all(
		[
			loadVisibleRelationshipSchemas(executionScope, source.schemas),
			loadRelationshipEndpointEntitySchemas(
				executionScope,
				source.schemas,
				"source",
				source.sourceEntity.schemas,
			),
			loadRelationshipEndpointEntitySchemas(
				executionScope,
				source.schemas,
				"target",
				source.targetEntity.schemas,
			),
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
	executionScope: QueryExecutionScope,
	language: string | null,
	source: RootSource,
	pushedConditions: readonly SqlFragment[],
) {
	if (source.type === "entities") {
		const visible = yield* loadVisibleEntitySchemas(executionScope, source.schemas);
		return entityRootFromWhereSql(visible, executionScope, language, pushedConditions);
	}
	if (source.type === "events") {
		const visibleEntitySchemas = yield* loadVisibleEntitySchemas(
			executionScope,
			source.entity.schemas,
		);
		const entitySchemaSlugs = visibleEntitySchemas.map((schema) => schema.id);
		const visibleEventSchemas = yield* loadVisibleEventSchemasForEntitySchemas(
			executionScope,
			entitySchemaSlugs,
			source.schemas,
		);
		return eventRootFromWhereSql(
			idListSql(visibleEventSchemas),
			sql.join(
				entitySchemaSlugs.map((id) => sql`${id}`),
				sql`, `,
			),
			executionScope,
			language,
			pushedConditions,
		);
	}
	const [visibleRelationshipSchemas, visibleSourceEntitySchemas, visibleTargetEntitySchemas] =
		yield* loadRelationshipRootVisibleSchemas(executionScope, source);
	return relationshipRootFromWhereSql(
		source.schemas,
		idListSql(visibleRelationshipSchemas),
		idListSql(visibleSourceEntitySchemas),
		idListSql(visibleTargetEntitySchemas),
		executionScope,
		language,
		pushedConditions,
	);
});
