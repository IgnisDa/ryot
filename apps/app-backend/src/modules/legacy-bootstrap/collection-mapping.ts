import { quoteSqlString } from "./shared";

export const buildCollectionEntityMigrationSql = (entitySchemaId: string) => `
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
		"image",
		"created_at",
		"populated_at",
		"user_id",
		"properties",
		"entity_schema_id",
		"sandbox_script_id",
		"updated_at"
	)
	SELECT
		collection.id,
		NULL,
		collection.name,
		NULL,
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
		${quoteSqlString(entitySchemaId)},
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
