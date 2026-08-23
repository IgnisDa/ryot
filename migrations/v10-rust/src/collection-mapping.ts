import type { QualifiedSchema } from "./migration-resolution";
import {
	buildRequireLegacyTableSql,
	buildReportSql,
	quoteNullableSqlString,
	quoteSqlString,
} from "./shared";

export const buildCollectionToEntityRelationshipMigrationSql = (
	addEntityToCollectionEventSchema: QualifiedSchema,
	memberOfRelationshipSchema: QualifiedSchema,
) => `
DO $$
DECLARE
	events_inserted int;
	relationships_inserted int;
	started_at timestamptz := clock_timestamp();
BEGIN
	${buildRequireLegacyTableSql("collection -> entity", "collection_to_entity")}

	INSERT INTO "relationship" (
		"id",
		"user_id",
		"source_entity_id",
		"target_entity_id",
		"relationship_schema_slug",
		"relationship_schema_plugin_id",
		"properties",
		"created_at"
	)
	SELECT
		md5(cte.id::text || ':member-of'),
		coll_entity.user_id,
		cte.entity_id,
		cte.collection_id,
		${quoteSqlString(memberOfRelationshipSchema.slug)},
		${quoteNullableSqlString(memberOfRelationshipSchema.pluginId)},
		COALESCE(cte.information, '{}'::jsonb) || jsonb_build_object('rank', cte.rank),
		cte.created_on
	FROM "collection_to_entity" cte
	INNER JOIN "entity" src_entity ON src_entity.id = cte.entity_id
	INNER JOIN "entity" coll_entity ON coll_entity.id = cte.collection_id
	ON CONFLICT DO NOTHING;

	GET DIAGNOSTICS relationships_inserted = ROW_COUNT;

	INSERT INTO "event" (
		"id",
		"user_id",
		"entity_id",
		"event_schema_slug",
		"event_schema_plugin_id",
		"properties",
		"created_at",
		"occurred_at"
	)
	SELECT
		'collection-membership-added-' || rel.id || '-event-0',
		rel.user_id,
		rel.target_entity_id,
		${quoteSqlString(addEntityToCollectionEventSchema.slug)},
		${quoteNullableSqlString(addEntityToCollectionEventSchema.pluginId)},
		jsonb_build_object(
			'entityId', rel.source_entity_id,
			'relationshipId', rel.id,
			'entitySchemaSlug', src_entity.entity_schema_slug,
			'relationshipProperties', rel.properties
		),
		cte.created_on,
		cte.created_on
	FROM "collection_to_entity" cte
	INNER JOIN "relationship" rel
		ON rel.id = md5(cte.id::text || ':member-of')
		AND rel.relationship_schema_slug = ${quoteSqlString(memberOfRelationshipSchema.slug)}
	INNER JOIN "entity" src_entity ON src_entity.id = rel.source_entity_id
	ON CONFLICT DO NOTHING;

	GET DIAGNOSTICS events_inserted = ROW_COUNT;
	${buildReportSql("collection_to_entity -> relationship", [
		{ count: "relationships_inserted", message: "relationship(s) migrated" },
		{ count: "events_inserted", message: "add event(s) migrated" },
	])}
END $$;
`;

export const buildMonitoringCollectionMigrationSql = (input: {
	libraryEntitySchema: QualifiedSchema;
	mediaMonitoringRelationshipSchema: QualifiedSchema;
	monitorableEntitySchemaSlugs: ReadonlyArray<string>;
}) => `
DO $$
DECLARE
	rows_inserted int;
	started_at timestamptz := clock_timestamp();
BEGIN
	${buildRequireLegacyTableSql("collection -> entity", "collection")}

	${buildRequireLegacyTableSql("collection -> entity", "collection_to_entity")}

	IF EXISTS (
		SELECT 1
		FROM "collection_to_entity" cte
		INNER JOIN "collection" coll ON coll.id = cte.collection_id AND coll.name = 'Monitoring'
		INNER JOIN "entity" src_entity ON src_entity.id = cte.entity_id
		WHERE src_entity.user_id IS NULL
			AND src_entity.external_id IS NOT NULL
			AND src_entity.provider_id IS NOT NULL
			AND src_entity.entity_schema_slug IN (${input.monitorableEntitySchemaSlugs.map(quoteSqlString).join(", ")})
			AND NOT EXISTS (
				SELECT 1
				FROM "entity" library_entity
				WHERE library_entity.user_id = coll.user_id
					AND library_entity.entity_schema_slug = ${quoteSqlString(input.libraryEntitySchema.slug)}
					AND library_entity.entity_schema_plugin_id IS NOT DISTINCT FROM ${quoteNullableSqlString(input.libraryEntitySchema.pluginId)}
					AND library_entity.external_id IS NULL
					AND library_entity.provider_id IS NULL
			)
	) THEN
		RAISE EXCEPTION 'Monitoring collection -> media-monitoring: a user owns a legacy Monitoring collection but has no V2 library entity to attach it to. Library entities are created earlier in this same run, so this is a defect in this migration rather than in the legacy data. Keep the dump and report it; retrying will not change the result.';
	END IF;

	INSERT INTO "relationship" (
		"id",
		"user_id",
		"source_entity_id",
		"target_entity_id",
		"relationship_schema_slug",
		"relationship_schema_plugin_id",
		"properties",
		"created_at"
	)
	SELECT
		md5(cte.id::text || ':media-monitoring'),
		coll.user_id,
		cte.entity_id,
		library_entity.id,
		${quoteSqlString(input.mediaMonitoringRelationshipSchema.slug)},
		${quoteNullableSqlString(input.mediaMonitoringRelationshipSchema.pluginId)},
		'{}'::jsonb,
		cte.created_on
	FROM "collection_to_entity" cte
	INNER JOIN "collection" coll ON coll.id = cte.collection_id AND coll.name = 'Monitoring'
	INNER JOIN "entity" src_entity ON src_entity.id = cte.entity_id
	INNER JOIN "entity" library_entity
		ON library_entity.user_id = coll.user_id
		AND library_entity.entity_schema_slug = ${quoteSqlString(input.libraryEntitySchema.slug)}
		AND library_entity.entity_schema_plugin_id IS NOT DISTINCT FROM ${quoteNullableSqlString(input.libraryEntitySchema.pluginId)}
		AND library_entity.external_id IS NULL
		AND library_entity.provider_id IS NULL
	WHERE src_entity.user_id IS NULL
		AND src_entity.external_id IS NOT NULL
		AND src_entity.provider_id IS NOT NULL
		AND src_entity.entity_schema_slug IN (${input.monitorableEntitySchemaSlugs.map(quoteSqlString).join(", ")})
	ON CONFLICT DO NOTHING;

	GET DIAGNOSTICS rows_inserted = ROW_COUNT;
	${buildReportSql("Monitoring collection -> media-monitoring", [{ count: "rows_inserted", message: "relationship(s) migrated" }])}
END $$;
`;

// Marks each Owned-collection member's existing in-media-library relationship as owned, mirroring the
// runtime ownership shape. Runs after user-to-entity so the relationships already exist.
export const buildOwnedCollectionOwnershipMigrationSql = (
	inLibraryRelationshipSchema: QualifiedSchema,
) => `
DO $$
DECLARE
	rows_updated int;
	started_at timestamptz := clock_timestamp();
BEGIN
	${buildRequireLegacyTableSql("collection -> entity", "collection")}

	${buildRequireLegacyTableSql("collection -> entity", "collection_to_entity")}

	UPDATE "relationship" rel
	SET "properties" = rel.properties || jsonb_build_object(
		'owned', true,
		'ownershipSources', jsonb_build_array('legacy'),
		'ownershipSyncedAt', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
	)
	FROM "collection_to_entity" cte
	INNER JOIN "collection" coll ON coll.id = cte.collection_id AND coll.name = 'Owned'
	WHERE rel.relationship_schema_slug = ${quoteSqlString(inLibraryRelationshipSchema.slug)}
		AND rel.relationship_schema_plugin_id IS NOT DISTINCT FROM ${quoteNullableSqlString(inLibraryRelationshipSchema.pluginId)}
		AND rel.source_entity_id = cte.entity_id
		AND rel.user_id = coll.user_id;

	GET DIAGNOSTICS rows_updated = ROW_COUNT;
	${buildReportSql("Owned collection -> in-media-library ownership", [{ count: "rows_updated", message: "relationship(s) updated" }])}
END $$;
`;

export const buildCollectionEntityMigrationSql = (entitySchema: QualifiedSchema) => `
DO $$
DECLARE
	rows_inserted int;
	started_at timestamptz := clock_timestamp();
BEGIN
	${buildRequireLegacyTableSql("collection -> entity", "collection")}

	INSERT INTO "entity" (
		"id",
		"external_id",
		"name",
		"created_at",
		"populated_at",
		"user_id",
		"properties",
		"entity_schema_slug",
		"entity_schema_plugin_id",
		"provider_id",
		"updated_at"
	)
	SELECT
		collection.id,
		NULL,
		collection.name,
		collection.created_on,
		NULL,
		collection.user_id,
		(
			CASE WHEN collection.description IS NOT NULL
				THEN jsonb_build_object('description', collection.description)
				ELSE '{}'::jsonb
			END
		)
		||
		(
			CASE
				WHEN collection.information_template IS NULL
					OR jsonb_typeof(collection.information_template) != 'array'
					OR jsonb_array_length(collection.information_template) = 0
				THEN '{}'::jsonb
				ELSE jsonb_build_object(
					'membershipPropertiesSchema',
					jsonb_build_object(
						'fields',
						(
							SELECT jsonb_object_agg(
								el->>'name',
								CASE
									WHEN jsonb_typeof(el->'possible_values') = 'array'
										AND jsonb_array_length(el->'possible_values') > 0
										AND el->>'lot' = 'StringArray'
									THEN
										jsonb_build_object(
											'type', 'enum-array',
											'label', el->>'name',
											'description', el->>'description',
											'options', el->'possible_values'
										)
										|| CASE WHEN (el->>'required')::boolean IS TRUE
											THEN jsonb_build_object('validation', jsonb_build_object('required', true))
											ELSE '{}'::jsonb
										END
									WHEN jsonb_typeof(el->'possible_values') = 'array'
										AND jsonb_array_length(el->'possible_values') > 0
									THEN
										jsonb_build_object(
											'type', 'enum',
											'label', el->>'name',
											'description', el->>'description',
											'options', el->'possible_values'
										)
										|| CASE WHEN el->>'default_value' IS NOT NULL AND el->>'default_value' != ''
											THEN jsonb_build_object('defaultValue', el->>'default_value')
											ELSE '{}'::jsonb
										END
										|| CASE WHEN (el->>'required')::boolean IS TRUE
											THEN jsonb_build_object('validation', jsonb_build_object('required', true))
											ELSE '{}'::jsonb
										END
									WHEN el->>'lot' = 'StringArray'
									THEN
										jsonb_build_object(
											'type', 'array',
											'label', el->>'name',
											'description', el->>'description',
											'items', jsonb_build_object(
												'type', 'string',
												'label', 'Item',
												'description', 'Item'
											)
										)
										|| CASE WHEN (el->>'required')::boolean IS TRUE
											THEN jsonb_build_object('validation', jsonb_build_object('required', true))
											ELSE '{}'::jsonb
										END
									ELSE
										jsonb_build_object(
											'type', CASE el->>'lot'
												WHEN 'Number' THEN 'number'
												WHEN 'Boolean' THEN 'boolean'
												WHEN 'Date' THEN 'date'
												WHEN 'DateTime' THEN 'datetime'
												ELSE 'string'
											END,
											'label', el->>'name',
											'description', el->>'description'
										)
										|| CASE WHEN el->>'default_value' IS NOT NULL AND el->>'default_value' != ''
											THEN
												CASE el->>'lot'
													WHEN 'Number' THEN jsonb_build_object('defaultValue', (el->>'default_value')::numeric)
													WHEN 'Boolean' THEN jsonb_build_object('defaultValue', (el->>'default_value')::boolean)
													ELSE jsonb_build_object('defaultValue', el->>'default_value')
												END
											ELSE '{}'::jsonb
										END
										|| CASE WHEN (el->>'required')::boolean IS TRUE
											THEN jsonb_build_object('validation', jsonb_build_object('required', true))
											ELSE '{}'::jsonb
										END
								END
							)
							FROM jsonb_array_elements(collection.information_template) AS el
						)
					)
				)
			END
		),
		${quoteSqlString(entitySchema.slug)},
		${quoteNullableSqlString(entitySchema.pluginId)},
		NULL,
		collection.last_updated_on
	FROM "collection"
	ON CONFLICT ("id") DO NOTHING;

	GET DIAGNOSTICS rows_inserted = ROW_COUNT;
	${buildReportSql("collection -> entity", [{ count: "rows_inserted", message: "row(s) migrated" }])}
END $$;
`;
