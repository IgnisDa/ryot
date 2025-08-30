import { sql } from "drizzle-orm";

import type { DbClient } from "~/lib/db";

import { quoteNullableSqlString, quoteSqlString } from "./shared";

type EntityMigrationTarget = {
	source: string;
	entitySchemaSlug: string;
	sandboxScriptSlug: string | null;
};

type ResolvedEntityMigrationTarget = {
	source: string;
	entitySchemaId: string;
	sandboxScriptId: string | null;
};

type ResolvedRelationshipMigrationTarget = {
	lot: string;
	relationshipSchemaId: string;
};

const legacyPersonCompanyPredicateSql = (tableAlias: string) => `(
	COALESCE((${tableAlias}.source_specifics ->> 'is_tmdb_company')::boolean, false)
	OR COALESCE((${tableAlias}.source_specifics ->> 'is_tvdb_company')::boolean, false)
	OR COALESCE((${tableAlias}.source_specifics ->> 'is_anilist_studio')::boolean, false)
	OR COALESCE((${tableAlias}.source_specifics ->> 'is_giant_bomb_company')::boolean, false)
	OR COALESCE((${tableAlias}.source_specifics ->> 'is_hardcover_publisher')::boolean, false)
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

const buildLegacyPrimaryImageSql = (tableAlias: string) => `CASE
	WHEN jsonb_array_length(COALESCE(${tableAlias}.assets -> 'remote_images', '[]'::jsonb)) > 0 THEN jsonb_build_object(
		'type', 'remote',
		'url', ${tableAlias}.assets -> 'remote_images' ->> 0
	)
	WHEN jsonb_array_length(COALESCE(${tableAlias}.assets -> 's3_images', '[]'::jsonb)) > 0 THEN jsonb_build_object(
		'type', 's3',
		'key', ${tableAlias}.assets -> 's3_images' ->> 0
	)
	ELSE NULL
END`;

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

const buildRawEntityTargetValuesSql = (targets: readonly EntityMigrationTarget[]) =>
	targets
		.map(
			(target) =>
				`(${quoteSqlString(target.source)}, ${quoteSqlString(target.entitySchemaSlug)}, ${quoteNullableSqlString(target.sandboxScriptSlug)})`,
		)
		.join(", ");

const buildResolvedEntityTargetValuesSql = (targets: readonly ResolvedEntityMigrationTarget[]) =>
	targets
		.map(
			(target) =>
				`(${quoteSqlString(target.source)}, ${quoteSqlString(target.entitySchemaId)}, ${quoteNullableSqlString(target.sandboxScriptId)})`,
		)
		.join(", ");

const buildResolvedRelationshipTargetValuesSql = (
	targets: readonly ResolvedRelationshipMigrationTarget[],
) =>
	targets
		.map(
			(target) => `(${quoteSqlString(target.lot)}, ${quoteSqlString(target.relationshipSchemaId)})`,
		)
		.join(", ");

const legacyPersonEntityTargetsRaw = [
	{ source: "anilist", entitySchemaSlug: "person", sandboxScriptSlug: "person.anilist" },
	{ source: "audible", entitySchemaSlug: "person", sandboxScriptSlug: "person.audible" },
	{ source: "custom", entitySchemaSlug: "person", sandboxScriptSlug: null },
	{ source: "giant_bomb", entitySchemaSlug: "person", sandboxScriptSlug: null },
	{ source: "hardcover", entitySchemaSlug: "person", sandboxScriptSlug: "person.hardcover" },
	{ source: "igdb", entitySchemaSlug: "person", sandboxScriptSlug: null },
	{ source: "manga_updates", entitySchemaSlug: "person", sandboxScriptSlug: null },
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

const legacyCompanyEntityTargetsRaw = [
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

export const personEntityTargets = legacyPersonEntityTargetsRaw;

export const companyEntityTargets = legacyCompanyEntityTargetsRaw;

type EntityMigrationKind = "person" | "company";

type EntityMigrationInput = {
	kind: EntityMigrationKind;
	targets: ResolvedEntityMigrationTarget[];
};

type RelationshipMigrationInput = {
	kind: EntityMigrationKind;
	targets: ResolvedRelationshipMigrationTarget[];
};

const buildLegacyEntityMigrationSql = ({ kind, targets }: EntityMigrationInput) => {
	const isCompany = kind === "company";
	const propertiesSql = isCompany
		? buildLegacyCompanyPropertiesSql("legacy_person")
		: buildLegacyPersonPropertiesSql("legacy_person");
	const userIdSql = "legacy_person.created_by_user_id";
	const kindNotice = isCompany ? "company" : "person";
	const companyFilterSql = legacyPersonCompanyPredicateSql("legacy_person");

	return `
DO $$
DECLARE rows_inserted int;
BEGIN
	WITH person_targets (source, entity_schema_id, sandbox_script_id) AS (
		VALUES ${buildResolvedEntityTargetValuesSql(targets)}
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
		${buildLegacyPrimaryImageSql("legacy_person")},
		legacy_person.created_on,
		NULL,
		${userIdSql},
		${propertiesSql},
		person_targets.entity_schema_id,
		person_targets.sandbox_script_id,
		legacy_person.last_updated_on
	FROM "person" legacy_person
	INNER JOIN person_targets ON person_targets.source = legacy_person.source
	WHERE ${isCompany ? companyFilterSql : `NOT ${companyFilterSql}`}
	ON CONFLICT ("id") DO NOTHING;
	GET DIAGNOSTICS rows_inserted = ROW_COUNT;
	RAISE NOTICE '${kindNotice} -> entity: % row(s) migrated', rows_inserted;
END $$;
`;
};

const buildLegacyRelationshipRollupsSql = ({ kind, targets }: RelationshipMigrationInput) => {
	const userIdSql = "legacy_person.created_by_user_id";
	const companyFilterSql = legacyPersonCompanyPredicateSql("legacy_person");

	return `
	WITH relationship_targets (lot, relationship_schema_id) AS (
		VALUES ${buildResolvedRelationshipTargetValuesSql(targets)}
	),
	legacy_people AS (
		SELECT
			legacy_person.id,
			${userIdSql} AS user_id,
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
		WHERE legacy_people.is_company = ${kind === "company" ? "TRUE" : "FALSE"}
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
	)
`;
};

const buildLegacyRelationshipInsertSql = ({ kind, targets }: RelationshipMigrationInput) => {
	const isCompany = kind === "company";
	const kindNotice = isCompany ? "company" : "person";
	const baseSql = buildLegacyRelationshipRollupsSql({ kind, targets });

	if (isCompany) {
		return `
DO $$
DECLARE rows_inserted int;
BEGIN
${baseSql}
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
		jsonb_build_object(
			'order', rollups.relationship_order,
			'roles', roles_rollup.roles
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
	GET DIAGNOSTICS rows_inserted = ROW_COUNT;
	RAISE NOTICE '${kindNotice} -> relationship: % row(s) migrated', rows_inserted;

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
				'roles', roles_rollup.roles
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
	GET DIAGNOSTICS rows_inserted = ROW_COUNT;
	RAISE NOTICE '${kindNotice} -> relationship (user-scoped): % row(s) migrated', rows_inserted;
END $$;
`;
	}

	return `
DO $$
DECLARE rows_inserted int;
BEGIN
${baseSql}
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
				'roles', roles_rollup.roles,
				'character', rollups.character
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
	GET DIAGNOSTICS rows_inserted = ROW_COUNT;
	RAISE NOTICE '${kindNotice} -> relationship (global): % row(s) migrated', rows_inserted;

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
				'roles', roles_rollup.roles,
				'character', rollups.character
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
	GET DIAGNOSTICS rows_inserted = ROW_COUNT;
	RAISE NOTICE '${kindNotice} -> relationship (user-scoped): % row(s) migrated', rows_inserted;
END $$;
`;
};

export const buildPersonEntityMigrationSql = (targets: ResolvedEntityMigrationTarget[]) =>
	buildLegacyEntityMigrationSql({ kind: "person", targets });

export const buildCompanyEntityMigrationSql = (targets: ResolvedEntityMigrationTarget[]) =>
	buildLegacyEntityMigrationSql({ kind: "company", targets });

export const buildPersonRelationshipMigrationSql = (
	targets: ResolvedRelationshipMigrationTarget[],
) => buildLegacyRelationshipInsertSql({ kind: "person", targets });

export const buildCompanyRelationshipMigrationSql = (
	targets: ResolvedRelationshipMigrationTarget[],
) => buildLegacyRelationshipInsertSql({ kind: "company", targets });

export const getUnsupportedPersonSources = async (database: DbClient) => {
	const result = await database.execute<{ source: string; entity_kind: string }>(sql`
		WITH person_targets (source, entity_schema_slug, sandbox_script_slug) AS (
			VALUES ${sql.raw(buildRawEntityTargetValuesSql(legacyPersonEntityTargetsRaw))}
		),
		company_targets (source, entity_schema_slug, sandbox_script_slug) AS (
			VALUES ${sql.raw(buildRawEntityTargetValuesSql(legacyCompanyEntityTargetsRaw))}
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
