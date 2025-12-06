import { type ResolvedEntityMigrationTarget, buildEntityTargetValuesSql } from "./shared";

type EntityMigrationInput = {
	kind: "person" | "company";
	targets: ResolvedEntityMigrationTarget[];
};

export const legacyPersonCompanyPredicateSql = (tableAlias: string) => `(
	COALESCE((${tableAlias}.source_specifics ->> 'is_tmdb_company')::boolean, false)
	OR COALESCE((${tableAlias}.source_specifics ->> 'is_tvdb_company')::boolean, false)
	OR COALESCE((${tableAlias}.source_specifics ->> 'is_anilist_studio')::boolean, false)
	OR COALESCE((${tableAlias}.source_specifics ->> 'is_giant_bomb_company')::boolean, false)
	OR COALESCE((${tableAlias}.source_specifics ->> 'is_hardcover_publisher')::boolean, false)
	OR ${tableAlias}.source = 'igdb'
)`;

const buildLegacyImageArraySql = (tableAlias: string) => `(
	COALESCE(
		(
			SELECT jsonb_agg(
				jsonb_build_object('type', 'remote', 'url', remote_image)
				ORDER BY ordinality
			)
			FROM jsonb_array_elements_text(COALESCE(${tableAlias}.assets -> 'remote_images', '[]'::jsonb))
				WITH ORDINALITY AS remote(remote_image, ordinality)
		),
		'[]'::jsonb
	)
	||
	COALESCE(
		(
			SELECT jsonb_agg(
				jsonb_build_object('type', 's3', 'key', s3_image)
				ORDER BY ordinality
			)
			FROM jsonb_array_elements_text(COALESCE(${tableAlias}.assets -> 's3_images', '[]'::jsonb))
				WITH ORDINALITY AS s3(s3_image, ordinality)
		),
		'[]'::jsonb
	)
)`;

const buildLegacyPersonPropertiesSql = (tableAlias: string) => `jsonb_build_object(
	'images', ${buildLegacyImageArraySql(tableAlias)},
	'gender', ${tableAlias}.gender,
	'website', ${tableAlias}.website,
	'sourceUrl', ${tableAlias}.source_url,
	'birthDate', to_char(${tableAlias}.birth_date, 'YYYY-MM-DD'),
	'deathDate', to_char(${tableAlias}.death_date, 'YYYY-MM-DD'),
	'birthPlace', ${tableAlias}.place,
	'description', ${tableAlias}.description,
	'alternateNames', COALESCE(to_jsonb(${tableAlias}.alternate_names), '[]'::jsonb)
)`;

const buildLegacyCompanyPropertiesSql = (tableAlias: string) => `jsonb_build_object(
	'foundedYear', NULL,
	'website', ${tableAlias}.website,
	'images', ${buildLegacyImageArraySql(tableAlias)},
	'alternateNames', COALESCE(to_jsonb(${tableAlias}.alternate_names), '[]'::jsonb),
	'sourceUrl', ${tableAlias}.source_url,
	'headquarters', ${tableAlias}.place,
	'description', ${tableAlias}.description
)`;

export const buildLegacyEntityMigrationSql = ({ kind, targets }: EntityMigrationInput) => {
	const isCompany = kind === "company";
	const propertiesSql = isCompany
		? buildLegacyCompanyPropertiesSql("legacy_person")
		: buildLegacyPersonPropertiesSql("legacy_person");
	const kindNotice = isCompany ? "company" : "person";
	const companyFilterSql = legacyPersonCompanyPredicateSql("legacy_person");

	return `
DO $$
DECLARE
	batch_size constant int := 10000;
	batch_rows_inserted int;
	cursor_id text := '';
	next_cursor_id text;
	rows_inserted int := 0;
	started_at timestamptz := clock_timestamp();
BEGIN
	RAISE NOTICE '${kindNotice} -> entity: migration started (% seconds elapsed)', 0.0;

	LOOP
		WITH person_targets (source, entity_schema_id, sandbox_script_id) AS (
			VALUES ${buildEntityTargetValuesSql(targets)}
		), batch AS (
			SELECT legacy_person.id::text AS id
			FROM "person" legacy_person
			INNER JOIN person_targets ON person_targets.source = legacy_person.source
			WHERE ${isCompany ? companyFilterSql : `NOT ${companyFilterSql}`}
				AND legacy_person.id::text > cursor_id
				AND (
					person_targets.sandbox_script_id IS NULL
					OR EXISTS (SELECT 1 FROM _referenced_global_entity_ids r WHERE r.id = legacy_person.id::text)
				)
			ORDER BY legacy_person.id::text
			LIMIT batch_size
		)
		SELECT MAX(batch.id) INTO next_cursor_id FROM batch;

		EXIT WHEN next_cursor_id IS NULL;

		WITH person_targets (source, entity_schema_id, sandbox_script_id) AS (
			VALUES ${buildEntityTargetValuesSql(targets)}
		)
		INSERT INTO entity (
			"id",
			"external_id",
			"name",
			"created_at",
			"populated_at",
			"user_id",
			"properties",
			"entity_schema_id",
			"sandbox_script_id",
			"updated_at"
		)
		SELECT
			legacy_person.id,
			legacy_person.identifier,
			legacy_person.name,
			legacy_person.created_on,
			NULL,
			legacy_person.created_by_user_id,
			CASE
				WHEN person_targets.sandbox_script_id IS NULL THEN ${propertiesSql}
				ELSE '{}'::jsonb
			END,
			person_targets.entity_schema_id,
			person_targets.sandbox_script_id,
			legacy_person.last_updated_on
		FROM "person" legacy_person
		INNER JOIN person_targets ON person_targets.source = legacy_person.source
		WHERE ${isCompany ? companyFilterSql : `NOT ${companyFilterSql}`}
			AND legacy_person.id::text > cursor_id
			AND legacy_person.id::text <= next_cursor_id
			AND (
				person_targets.sandbox_script_id IS NULL
				OR EXISTS (SELECT 1 FROM _referenced_global_entity_ids r WHERE r.id = legacy_person.id::text)
			)
		ON CONFLICT ("id") DO NOTHING;
		GET DIAGNOSTICS batch_rows_inserted = ROW_COUNT;

		rows_inserted := rows_inserted + batch_rows_inserted;
		cursor_id := next_cursor_id;
	END LOOP;

	RAISE NOTICE '${kindNotice} -> entity: % row(s) migrated total (% seconds elapsed)',
		rows_inserted,
		round(extract(epoch from clock_timestamp() - started_at)::numeric, 1);
END $$;
`;
};
