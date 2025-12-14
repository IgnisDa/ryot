import { legacyPersonCompanyPredicateSql } from "./person-mapping-entity-sql";
import { type ResolvedRelationshipTarget, buildRelationshipTargetValuesSql } from "./shared";

// Provider cast/crew credits between provider entities are rebuilt by V2 on population and are not
// migrated. Only user-authored credits (an endpoint owned by a user) are migrated; both endpoints
// are custom entities (migrated in full) or provider skeletons pulled into the referenced set, so
// the INNER JOIN on "entity" is FK-safe. See "Slim Migration Strategy" in AGENTS.md.

type RelationshipMigrationInput = {
	kind: "person" | "company";
	targets: ResolvedRelationshipTarget[];
};

export const buildLegacyRelationshipInsertSql = ({ kind, targets }: RelationshipMigrationInput) => {
	const isCompany = kind === "company";
	const kindNotice = isCompany ? "company" : "person";
	const companyFilterSql = legacyPersonCompanyPredicateSql("legacy_person");
	const isCompanyFilter = isCompany ? "TRUE" : "FALSE";
	const characterSql = isCompany ? "" : `,\n\t\t\t\t'character', rollups.character`;

	return `
DO $$
DECLARE
	rows_inserted int;
	started_at timestamptz := clock_timestamp();
BEGIN
	RAISE NOTICE '${kindNotice} -> relationship: migration started (% seconds elapsed)', 0.0;

	IF EXISTS (
		WITH relationship_targets (lot, relationship_schema_id) AS (
			VALUES ${buildRelationshipTargetValuesSql(targets)}
		), legacy_people AS (
			SELECT
				legacy_person.id,
				legacy_person.created_by_user_id AS person_user_id,
				${companyFilterSql} AS is_company
			FROM "person" legacy_person
		)
		SELECT 1
		FROM "metadata_to_person" m2p
		INNER JOIN legacy_people ON legacy_people.id = m2p.person_id
		INNER JOIN "metadata" metadata ON metadata.id = m2p.metadata_id
		INNER JOIN relationship_targets ON relationship_targets.lot = metadata.lot
		WHERE legacy_people.is_company = ${isCompanyFilter}
			AND legacy_people.person_user_id IS NOT NULL
			AND metadata.created_by_user_id IS NOT NULL
			AND legacy_people.person_user_id <> metadata.created_by_user_id
		LIMIT 1
	) THEN
		RAISE EXCEPTION '${kindNotice} -> relationship: found relationship between entities owned by different users';
	END IF;

	WITH relationship_targets (lot, relationship_schema_id) AS (
		VALUES ${buildRelationshipTargetValuesSql(targets)}
	), legacy_people AS (
		SELECT
			legacy_person.id,
			legacy_person.created_by_user_id AS person_user_id,
			${companyFilterSql} AS is_company
		FROM "person" legacy_person
	), legacy_relationships AS (
		SELECT
			m2p.metadata_id,
			m2p.person_id,
			m2p.role,
			m2p."character",
			m2p."index" AS credit_index,
			CASE
				WHEN legacy_people.person_user_id IS NULL THEN metadata.created_by_user_id
				WHEN metadata.created_by_user_id IS NULL THEN legacy_people.person_user_id
				WHEN legacy_people.person_user_id = metadata.created_by_user_id THEN legacy_people.person_user_id
			END AS user_id,
			relationship_targets.relationship_schema_id
		FROM "metadata_to_person" m2p
		INNER JOIN legacy_people ON legacy_people.id = m2p.person_id
		INNER JOIN "metadata" metadata ON metadata.id = m2p.metadata_id
		INNER JOIN relationship_targets ON relationship_targets.lot = metadata.lot
		WHERE legacy_people.is_company = ${isCompanyFilter}
			AND (legacy_people.person_user_id IS NOT NULL OR metadata.created_by_user_id IS NOT NULL)
	), role_groups AS (
		SELECT
			metadata_id, person_id, relationship_schema_id, user_id, role,
			MIN(COALESCE(credit_index, 2147483647)) AS role_order
		FROM legacy_relationships
		GROUP BY metadata_id, person_id, relationship_schema_id, user_id, role
	), roles_rollup AS (
		SELECT
			metadata_id, person_id, relationship_schema_id, user_id,
			jsonb_agg(role ORDER BY role_order, role) AS roles
		FROM role_groups
		GROUP BY metadata_id, person_id, relationship_schema_id, user_id
	), rollups AS (
		SELECT
			metadata_id, person_id, relationship_schema_id, user_id,
			MIN(COALESCE(credit_index, 2147483647)) AS relationship_order,
			(
				array_agg("character" ORDER BY COALESCE(credit_index, 2147483647), role)
				FILTER (WHERE "character" IS NOT NULL)
			)[1] AS character
		FROM legacy_relationships
		GROUP BY metadata_id, person_id, relationship_schema_id, user_id
	)
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
	INNER JOIN "entity" src ON src.id = rollups.person_id
	INNER JOIN "entity" tgt ON tgt.id = rollups.metadata_id
	WHERE rollups.user_id IS NOT NULL
	ON CONFLICT ("user_id", "source_entity_id", "target_entity_id", "relationship_schema_id") DO NOTHING;
	GET DIAGNOSTICS rows_inserted = ROW_COUNT;

	RAISE NOTICE '${kindNotice} -> relationship: % user-authored row(s) migrated (% seconds elapsed)',
		rows_inserted,
		round(extract(epoch from clock_timestamp() - started_at)::numeric, 1);
END $$;
`;
};

export const buildLegacyGroupPersonRelationshipInsertSql = (
	targets: ResolvedRelationshipTarget[],
) => `
DO $$
DECLARE
	rows_inserted int;
	started_at timestamptz := clock_timestamp();
BEGIN
	RAISE NOTICE 'group_person -> relationship: migration started (% seconds elapsed)', 0.0;

	IF EXISTS (
		WITH relationship_targets (lot, relationship_schema_id) AS (
			VALUES ${buildRelationshipTargetValuesSql(targets)}
		)
		SELECT 1
		FROM "metadata_group_to_person" mg2p
		INNER JOIN "metadata_group" mg ON mg.id = mg2p.metadata_group_id
		INNER JOIN relationship_targets ON relationship_targets.lot = mg.lot
		INNER JOIN "person" legacy_person ON legacy_person.id = mg2p.person_id
		WHERE legacy_person.created_by_user_id IS NOT NULL
			AND mg.created_by_user_id IS NOT NULL
			AND legacy_person.created_by_user_id <> mg.created_by_user_id
		LIMIT 1
	) THEN
		RAISE EXCEPTION 'group_person -> relationship: found relationship between entities owned by different users';
	END IF;

	WITH relationship_targets (lot, relationship_schema_id) AS (
		VALUES ${buildRelationshipTargetValuesSql(targets)}
	), legacy_relationships AS (
		SELECT
			mg2p.metadata_group_id,
			mg2p.person_id,
			mg2p.role,
			mg2p."index" AS credit_index,
			CASE
				WHEN legacy_person.created_by_user_id IS NULL THEN mg.created_by_user_id
				WHEN mg.created_by_user_id IS NULL THEN legacy_person.created_by_user_id
				WHEN legacy_person.created_by_user_id = mg.created_by_user_id THEN legacy_person.created_by_user_id
			END AS user_id,
			relationship_targets.relationship_schema_id
		FROM "metadata_group_to_person" mg2p
		INNER JOIN "metadata_group" mg ON mg.id = mg2p.metadata_group_id
		INNER JOIN relationship_targets ON relationship_targets.lot = mg.lot
		INNER JOIN "person" legacy_person ON legacy_person.id = mg2p.person_id
		WHERE legacy_person.created_by_user_id IS NOT NULL OR mg.created_by_user_id IS NOT NULL
	), role_groups AS (
		SELECT
			metadata_group_id, person_id, relationship_schema_id, user_id, role,
			MIN(COALESCE(credit_index, 2147483647)) AS role_order
		FROM legacy_relationships
		GROUP BY metadata_group_id, person_id, relationship_schema_id, user_id, role
	), roles_rollup AS (
		SELECT
			metadata_group_id, person_id, relationship_schema_id, user_id,
			jsonb_agg(role ORDER BY role_order, role) AS roles
		FROM role_groups
		GROUP BY metadata_group_id, person_id, relationship_schema_id, user_id
	), rollups AS (
		SELECT
			metadata_group_id, person_id, relationship_schema_id, user_id,
			MIN(COALESCE(credit_index, 2147483647)) AS relationship_order
		FROM legacy_relationships
		GROUP BY metadata_group_id, person_id, relationship_schema_id, user_id
	)
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
		rollups.metadata_group_id,
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
	INNER JOIN roles_rollup ON rollups.metadata_group_id = roles_rollup.metadata_group_id
		AND rollups.person_id = roles_rollup.person_id
		AND rollups.relationship_schema_id = roles_rollup.relationship_schema_id
		AND rollups.user_id IS NOT DISTINCT FROM roles_rollup.user_id
	INNER JOIN "entity" src ON src.id = rollups.person_id
	INNER JOIN "entity" tgt ON tgt.id = rollups.metadata_group_id
	WHERE rollups.user_id IS NOT NULL
	ON CONFLICT ("user_id", "source_entity_id", "target_entity_id", "relationship_schema_id") DO NOTHING;
	GET DIAGNOSTICS rows_inserted = ROW_COUNT;

	RAISE NOTICE 'group_person -> relationship: % user-authored row(s) migrated (% seconds elapsed)',
		rows_inserted,
		round(extract(epoch from clock_timestamp() - started_at)::numeric, 1);
END $$;
`;
