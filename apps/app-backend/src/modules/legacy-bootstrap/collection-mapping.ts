import { quoteSqlString } from "./shared";

export const buildCollectionToEntityRelationshipMigrationSql = (
	memberOfRelationshipSchemaSlug: string,
) => `
DO $$
DECLARE
	rows_inserted int;
	started_at timestamptz := clock_timestamp();
BEGIN
	IF to_regclass('"collection_to_entity"') IS NULL THEN
		RAISE EXCEPTION 'Expected collection_to_entity table to exist in a V1 database but it was not found';
	END IF;

	RAISE NOTICE 'collection_to_entity -> relationship: migration started (% seconds elapsed)', 0.0;

	INSERT INTO "relationship" (
		"id",
		"user_id",
		"source_entity_id",
		"target_entity_id",
		"relationship_schema_slug",
		"properties",
		"created_at"
	)
	SELECT
		md5(cte.id::text || ':member-of'),
		coll_entity.user_id,
		cte.entity_id,
		cte.collection_id,
		${quoteSqlString(memberOfRelationshipSchemaSlug)},
		COALESCE(cte.information, '{}'::jsonb) || jsonb_build_object('rank', cte.rank),
		cte.created_on
	FROM "collection_to_entity" cte
	INNER JOIN "entity" src_entity ON src_entity.id = cte.entity_id
	INNER JOIN "entity" coll_entity ON coll_entity.id = cte.collection_id
	ON CONFLICT DO NOTHING;

	GET DIAGNOSTICS rows_inserted = ROW_COUNT;
	RAISE NOTICE 'collection_to_entity -> relationship: % row(s) migrated (% seconds elapsed)',
		rows_inserted,
		round(extract(epoch from clock_timestamp() - started_at)::numeric, 1);
END $$;
`;

export const buildMonitoringCollectionMigrationSql = (input: {
	libraryEntitySchemaSlug: string;
	mediaMonitoringRelationshipSchemaSlug: string;
	monitorableEntitySchemaSlugs: ReadonlyArray<string>;
}) => `
DO $$
DECLARE
	rows_inserted int;
	started_at timestamptz := clock_timestamp();
BEGIN
	IF to_regclass('"collection"') IS NULL THEN
		RAISE EXCEPTION 'Expected collection table to exist in a V1 database but it was not found';
	END IF;

	IF to_regclass('"collection_to_entity"') IS NULL THEN
		RAISE EXCEPTION 'Expected collection_to_entity table to exist in a V1 database but it was not found';
	END IF;

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
					AND library_entity.entity_schema_slug = ${quoteSqlString(input.libraryEntitySchemaSlug)}
					AND library_entity.external_id IS NULL
					AND library_entity.provider_id IS NULL
			)
	) THEN
		RAISE EXCEPTION 'Expected each legacy Monitoring collection owner to have a V2 library entity';
	END IF;

	RAISE NOTICE 'Monitoring collection -> media-monitoring: migration started (% seconds elapsed)', 0.0;

	INSERT INTO "relationship" (
		"id",
		"user_id",
		"source_entity_id",
		"target_entity_id",
		"relationship_schema_slug",
		"properties",
		"created_at"
	)
	SELECT
		md5(cte.id::text || ':media-monitoring'),
		coll.user_id,
		cte.entity_id,
		library_entity.id,
		${quoteSqlString(input.mediaMonitoringRelationshipSchemaSlug)},
		'{}'::jsonb,
		cte.created_on
	FROM "collection_to_entity" cte
	INNER JOIN "collection" coll ON coll.id = cte.collection_id AND coll.name = 'Monitoring'
	INNER JOIN "entity" src_entity ON src_entity.id = cte.entity_id
	INNER JOIN "entity" library_entity
		ON library_entity.user_id = coll.user_id
		AND library_entity.entity_schema_slug = ${quoteSqlString(input.libraryEntitySchemaSlug)}
		AND library_entity.external_id IS NULL
		AND library_entity.provider_id IS NULL
	WHERE src_entity.user_id IS NULL
		AND src_entity.external_id IS NOT NULL
		AND src_entity.provider_id IS NOT NULL
		AND src_entity.entity_schema_slug IN (${input.monitorableEntitySchemaSlugs.map(quoteSqlString).join(", ")})
	ON CONFLICT DO NOTHING;

	GET DIAGNOSTICS rows_inserted = ROW_COUNT;
	RAISE NOTICE 'Monitoring collection -> media-monitoring: % relationship(s) migrated (% seconds elapsed)',
		rows_inserted,
		round(extract(epoch from clock_timestamp() - started_at)::numeric, 1);
END $$;
`;

// Marks each Owned-collection member's existing in-library relationship as owned, mirroring the
// runtime ownership shape. Runs after user-to-entity so the relationships already exist.
export const buildOwnedCollectionOwnershipMigrationSql = (
	inLibraryRelationshipSchemaSlug: string,
) => `
DO $$
DECLARE
	rows_updated int;
	started_at timestamptz := clock_timestamp();
BEGIN
	IF to_regclass('"collection"') IS NULL THEN
		RAISE EXCEPTION 'Expected collection table to exist in a V1 database but it was not found';
	END IF;

	IF to_regclass('"collection_to_entity"') IS NULL THEN
		RAISE EXCEPTION 'Expected collection_to_entity table to exist in a V1 database but it was not found';
	END IF;

	RAISE NOTICE 'Owned collection -> in-library ownership: migration started (% seconds elapsed)', 0.0;

	UPDATE "relationship" rel
	SET "properties" = rel.properties || jsonb_build_object(
		'owned', true,
		'ownershipSources', jsonb_build_array('legacy'),
		'ownershipSyncedAt', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
	)
	FROM "collection_to_entity" cte
	INNER JOIN "collection" coll ON coll.id = cte.collection_id AND coll.name = 'Owned'
	WHERE rel.relationship_schema_slug = ${quoteSqlString(inLibraryRelationshipSchemaSlug)}
		AND rel.source_entity_id = cte.entity_id
		AND rel.user_id = coll.user_id;

	GET DIAGNOSTICS rows_updated = ROW_COUNT;
	RAISE NOTICE 'Owned collection -> in-library ownership: % relationship(s) updated (% seconds elapsed)',
		rows_updated,
		round(extract(epoch from clock_timestamp() - started_at)::numeric, 1);
END $$;
`;

export const buildCollectionEntityMigrationSql = (entitySchemaSlug: string) => `
DO $$
DECLARE
	rows_inserted int;
	started_at timestamptz := clock_timestamp();
BEGIN
	IF to_regclass('"collection"') IS NULL THEN
		RAISE EXCEPTION 'Expected collection table to exist in a V1 database but it was not found';
	END IF;

	RAISE NOTICE 'collection -> entity: migration started (% seconds elapsed)', 0.0;

	INSERT INTO "entity" (
		"id",
		"external_id",
		"name",
		"created_at",
		"populated_at",
		"user_id",
		"properties",
		"entity_schema_slug",
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
		${quoteSqlString(entitySchemaSlug)},
		NULL,
		collection.last_updated_on
	FROM "collection"
	ON CONFLICT ("id") DO NOTHING;

	GET DIAGNOSTICS rows_inserted = ROW_COUNT;
	RAISE NOTICE 'collection -> entity: % row(s) migrated (% seconds elapsed)',
		rows_inserted,
		round(extract(epoch from clock_timestamp() - started_at)::numeric, 1);
END $$;
`;
