import { sql } from "drizzle-orm";

import type { DbClient } from "~/lib/db";

import {
	type EntityMigrationTarget,
	type ResolvedEntityMigrationTarget,
	type ResolvedRelationshipTarget,
	buildEntityTargetValuesSql,
	buildPrimaryImageSql,
	buildRelationshipTargetValuesSql,
} from "./shared";

type RelationshipMigrationInput = {
	kind: "person" | "company";
	targets: ResolvedRelationshipTarget[];
};

type EntityMigrationInput = {
	kind: "person" | "company";
	targets: ResolvedEntityMigrationTarget[];
};

const legacyPersonCompanyPredicateSql = (tableAlias: string) => `(
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

export const personEntityTargets = [
	{ source: "anilist", entitySchemaSlug: "person", sandboxScriptSlug: "person.anilist" },
	{ source: "audible", entitySchemaSlug: "person", sandboxScriptSlug: "person.audible" },
	{ source: "custom", entitySchemaSlug: "person", sandboxScriptSlug: null },
	{ source: "giant_bomb", entitySchemaSlug: "person", sandboxScriptSlug: "person.giant-bomb" },
	{ source: "hardcover", entitySchemaSlug: "person", sandboxScriptSlug: "person.hardcover" },
	{
		source: "manga_updates",
		entitySchemaSlug: "person",
		sandboxScriptSlug: "person.manga-updates",
	},
	{ source: "metron", entitySchemaSlug: "person", sandboxScriptSlug: "person.metron" },
	{ source: "music_brainz", entitySchemaSlug: "person", sandboxScriptSlug: "person.musicbrainz" },
	{ source: "openlibrary", entitySchemaSlug: "person", sandboxScriptSlug: "person.openlibrary" },
	{ source: "spotify", entitySchemaSlug: "person", sandboxScriptSlug: "person.spotify" },
	{ source: "tmdb", entitySchemaSlug: "person", sandboxScriptSlug: "person.tmdb" },
	{ source: "tvdb", entitySchemaSlug: "person", sandboxScriptSlug: "person.tvdb" },
	{
		source: "youtube_music",
		entitySchemaSlug: "person",
		sandboxScriptSlug: "person.youtube-music",
	},
] as const satisfies readonly EntityMigrationTarget[];

export const companyEntityTargets = [
	{ source: "anilist", entitySchemaSlug: "company", sandboxScriptSlug: "company.anilist" },
	{
		source: "giant_bomb",
		entitySchemaSlug: "company",
		sandboxScriptSlug: "company.giant-bomb",
	},
	{ source: "hardcover", entitySchemaSlug: "company", sandboxScriptSlug: "company.hardcover" },
	{ source: "tmdb", entitySchemaSlug: "company", sandboxScriptSlug: "company.tmdb" },
	{ source: "tvdb", entitySchemaSlug: "company", sandboxScriptSlug: "company.tvdb" },
] as const satisfies readonly EntityMigrationTarget[];

const personEntityTargetValuesSql = sql.join(
	personEntityTargets.map((t) => sql`(${t.source}, ${t.entitySchemaSlug}, ${t.sandboxScriptSlug})`),
	sql`, `,
);

const companyEntityTargetValuesSql = sql.join(
	companyEntityTargets.map(
		(t) => sql`(${t.source}, ${t.entitySchemaSlug}, ${t.sandboxScriptSlug})`,
	),
	sql`, `,
);

const buildLegacyEntityMigrationSql = ({ kind, targets }: EntityMigrationInput) => {
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
			legacy_person.id,
			legacy_person.identifier,
			legacy_person.name,
			${buildPrimaryImageSql("legacy_person")},
			legacy_person.created_on,
			NULL,
			legacy_person.created_by_user_id,
			${propertiesSql},
			person_targets.entity_schema_id,
			person_targets.sandbox_script_id,
			legacy_person.last_updated_on
		FROM "person" legacy_person
		INNER JOIN person_targets ON person_targets.source = legacy_person.source
		WHERE ${isCompany ? companyFilterSql : `NOT ${companyFilterSql}`}
			AND legacy_person.id::text > cursor_id
			AND legacy_person.id::text <= next_cursor_id
		ON CONFLICT ("id") DO NOTHING;
		GET DIAGNOSTICS batch_rows_inserted = ROW_COUNT;

		rows_inserted := rows_inserted + batch_rows_inserted;
		cursor_id := next_cursor_id;
		RAISE NOTICE '${kindNotice} -> entity: % row(s) migrated so far (% seconds elapsed)',
			rows_inserted,
			round(extract(epoch from clock_timestamp() - started_at)::numeric, 1);
	END LOOP;

	RAISE NOTICE '${kindNotice} -> entity: % row(s) migrated total (% seconds elapsed)',
		rows_inserted,
		round(extract(epoch from clock_timestamp() - started_at)::numeric, 1);
END $$;
`;
};

// Returns a complete WITH...AS CTE block (no trailing semicolon) ready to be prepended to an
// INSERT statement. Must be repeated for each INSERT inside a DO block since CTE scope in
// PL/pgSQL is limited to the single SQL statement the WITH clause is attached to.
const buildRelationshipCtesSql = ({ kind, targets }: RelationshipMigrationInput) => {
	const companyFilterSql = legacyPersonCompanyPredicateSql("legacy_person");
	const isCompanyFilter = kind === "company" ? "TRUE" : "FALSE";

	return `WITH relationship_targets (lot, relationship_schema_id) AS (
		VALUES ${buildRelationshipTargetValuesSql(targets)}
	),
	legacy_people AS (
		SELECT
			legacy_person.id,
			legacy_person.created_by_user_id AS user_id,
			${companyFilterSql} AS is_company
		FROM "person" legacy_person
	),
	legacy_relationships AS (
		SELECT
			m2p.metadata_id,
			m2p.person_id,
			m2p.role,
			m2p."character",
			m2p."index" AS credit_index,
			legacy_people.user_id,
			relationship_targets.relationship_schema_id
		FROM "metadata_to_person" m2p
		INNER JOIN legacy_people ON legacy_people.id = m2p.person_id
		INNER JOIN "metadata" metadata ON metadata.id = m2p.metadata_id
		INNER JOIN relationship_targets ON relationship_targets.lot = metadata.lot
		WHERE legacy_people.is_company = ${isCompanyFilter}
			AND m2p.metadata_id::text > cursor_id
			AND m2p.metadata_id::text <= next_cursor_id
	),
	role_groups AS (
		SELECT
			metadata_id,
			person_id,
			relationship_schema_id,
			user_id,
			role,
			MIN(COALESCE(credit_index, 2147483647)) AS role_order
		FROM legacy_relationships
		GROUP BY metadata_id, person_id, relationship_schema_id, user_id, role
	),
	roles_rollup AS (
		SELECT
			metadata_id,
			person_id,
			relationship_schema_id,
			user_id,
			jsonb_agg(role ORDER BY role_order, role) AS roles
		FROM role_groups
		GROUP BY metadata_id, person_id, relationship_schema_id, user_id
	),
	rollups AS (
		SELECT
			metadata_id,
			person_id,
			relationship_schema_id,
			user_id,
			MIN(COALESCE(credit_index, 2147483647)) AS relationship_order,
			(
				array_agg("character" ORDER BY COALESCE(credit_index, 2147483647), role)
				FILTER (WHERE "character" IS NOT NULL)
			)[1] AS character
		FROM legacy_relationships
		GROUP BY metadata_id, person_id, relationship_schema_id, user_id
	)`;
};

const buildLegacyRelationshipInsertSql = ({ kind, targets }: RelationshipMigrationInput) => {
	const isCompany = kind === "company";
	const kindNotice = isCompany ? "company" : "person";
	const companyFilterSql = legacyPersonCompanyPredicateSql("legacy_person");
	const isCompanyFilter = isCompany ? "TRUE" : "FALSE";
	// character is preserved for person relationships; stripped from company relationships
	const characterSql = isCompany ? "" : `,\n\t\t\t\t'character', rollups.character`;
	const cteSql = buildRelationshipCtesSql({ kind, targets });

	return `
DO $$
DECLARE
	batch_size constant int := 10000;
	cursor_id text := '';
	next_cursor_id text;
	global_batch_rows_inserted int;
	global_rows_inserted int := 0;
	user_batch_rows_inserted int;
	user_rows_inserted int := 0;
	started_at timestamptz := clock_timestamp();
BEGIN
	RAISE NOTICE '${kindNotice} -> relationship: migration started (% seconds elapsed)', 0.0;

	LOOP
		WITH relationship_targets (lot, relationship_schema_id) AS (
			VALUES ${buildRelationshipTargetValuesSql(targets)}
		), legacy_people AS (
			SELECT
				legacy_person.id,
				${companyFilterSql} AS is_company
			FROM "person" legacy_person
		), batch AS (
			SELECT DISTINCT m2p.metadata_id::text AS id
			FROM "metadata_to_person" m2p
			INNER JOIN legacy_people ON legacy_people.id = m2p.person_id
			INNER JOIN "metadata" metadata ON metadata.id = m2p.metadata_id
			INNER JOIN relationship_targets ON relationship_targets.lot = metadata.lot
			WHERE legacy_people.is_company = ${isCompanyFilter}
				AND m2p.metadata_id::text > cursor_id
			ORDER BY m2p.metadata_id::text
			LIMIT batch_size
		)
		SELECT MAX(batch.id) INTO next_cursor_id FROM batch;

		EXIT WHEN next_cursor_id IS NULL;

		${cteSql}
		INSERT INTO relationship (
			"id",
			"source_entity_id",
			"target_entity_id",
			"relationship_schema_id",
			"properties",
			"user_id",
			"created_at"
		)
		SELECT
			gen_random_uuid()::text,
			rollups.person_id,
			rollups.metadata_id,
			rollups.relationship_schema_id,
			jsonb_strip_nulls(
				jsonb_build_object(
					'order', rollups.relationship_order,
					'roles', roles_rollup.roles${characterSql}
				)
			),
			NULL,
			NOW()
		FROM rollups
		INNER JOIN roles_rollup ON rollups.metadata_id = roles_rollup.metadata_id
			AND rollups.person_id = roles_rollup.person_id
			AND rollups.relationship_schema_id = roles_rollup.relationship_schema_id
			AND rollups.user_id IS NOT DISTINCT FROM roles_rollup.user_id
		WHERE rollups.user_id IS NULL
		ON CONFLICT ("source_entity_id", "target_entity_id", "relationship_schema_id") WHERE user_id IS NULL DO NOTHING;
		GET DIAGNOSTICS global_batch_rows_inserted = ROW_COUNT;

		${cteSql}
		INSERT INTO relationship (
			"id",
			"source_entity_id",
			"target_entity_id",
			"relationship_schema_id",
			"properties",
			"user_id",
			"created_at"
		)
		SELECT
			gen_random_uuid()::text,
			rollups.person_id,
			rollups.metadata_id,
			rollups.relationship_schema_id,
			jsonb_strip_nulls(
				jsonb_build_object(
					'order', rollups.relationship_order,
					'roles', roles_rollup.roles${characterSql}
				)
			),
			rollups.user_id,
			NOW()
		FROM rollups
		INNER JOIN roles_rollup ON rollups.metadata_id = roles_rollup.metadata_id
			AND rollups.person_id = roles_rollup.person_id
			AND rollups.relationship_schema_id = roles_rollup.relationship_schema_id
			AND rollups.user_id IS NOT DISTINCT FROM roles_rollup.user_id
		WHERE rollups.user_id IS NOT NULL
		ON CONFLICT ("user_id", "source_entity_id", "target_entity_id", "relationship_schema_id") DO NOTHING;
		GET DIAGNOSTICS user_batch_rows_inserted = ROW_COUNT;

		global_rows_inserted := global_rows_inserted + global_batch_rows_inserted;
		user_rows_inserted := user_rows_inserted + user_batch_rows_inserted;
		cursor_id := next_cursor_id;
		RAISE NOTICE '${kindNotice} -> relationship: % global row(s), % user-scoped row(s) migrated so far (% seconds elapsed)',
			global_rows_inserted,
			user_rows_inserted,
			round(extract(epoch from clock_timestamp() - started_at)::numeric, 1);
	END LOOP;

	RAISE NOTICE '${kindNotice} -> relationship: % global row(s), % user-scoped row(s) migrated total (% seconds elapsed)',
		global_rows_inserted,
		user_rows_inserted,
		round(extract(epoch from clock_timestamp() - started_at)::numeric, 1);
END $$;
`;
};

export const buildPersonEntityMigrationSql = (targets: ResolvedEntityMigrationTarget[]) =>
	buildLegacyEntityMigrationSql({ kind: "person", targets });

export const buildCompanyEntityMigrationSql = (targets: ResolvedEntityMigrationTarget[]) =>
	buildLegacyEntityMigrationSql({ kind: "company", targets });

export const buildPersonRelationshipMigrationSql = (targets: ResolvedRelationshipTarget[]) =>
	buildLegacyRelationshipInsertSql({ kind: "person", targets });

export const buildCompanyRelationshipMigrationSql = (targets: ResolvedRelationshipTarget[]) =>
	buildLegacyRelationshipInsertSql({ kind: "company", targets });

export const getUnsupportedPersonSources = async (database: DbClient) => {
	const result = await database.execute<{ source: string; entity_kind: string }>(sql`
		WITH person_targets (source, entity_schema_slug, sandbox_script_slug) AS (
			VALUES ${personEntityTargetValuesSql}
		),
		company_targets (source, entity_schema_slug, sandbox_script_slug) AS (
			VALUES ${companyEntityTargetValuesSql}
		),
		supported_targets AS (
			SELECT source, 'person' AS entity_kind FROM person_targets
			UNION ALL
			SELECT source, 'company' AS entity_kind FROM company_targets
		),
		classified_people AS (
			SELECT DISTINCT
				legacy_person.source AS source,
				CASE
					WHEN ${sql.raw(legacyPersonCompanyPredicateSql("legacy_person"))} THEN 'company'
					ELSE 'person'
				END AS entity_kind
			FROM "person" legacy_person
		)
		SELECT DISTINCT
			classified_people.source AS source,
			classified_people.entity_kind AS entity_kind
		FROM classified_people
		LEFT JOIN supported_targets ON supported_targets.source = classified_people.source
			AND supported_targets.entity_kind = classified_people.entity_kind
		WHERE supported_targets.source IS NULL
		ORDER BY classified_people.entity_kind, classified_people.source
	`);

	return result.rows;
};
