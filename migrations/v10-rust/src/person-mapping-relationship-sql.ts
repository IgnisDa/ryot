import { legacyPersonCompanyPredicateSql } from "./person-mapping-entity-sql";
import {
	type ResolvedRelationshipTarget,
	buildAbortOnRowsSql,
	buildRelationshipTargetValuesSql,
	buildReportSql,
} from "./shared";

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
	cross_owner_rows int := 0;
	cross_owner_sample text;
	started_at timestamptz := clock_timestamp();
BEGIN
	${buildAbortOnRowsSql({
		countVariable: "cross_owner_rows",
		sampleVariable: "cross_owner_sample",
		message:
			"${kindNotice} -> relationship: % user-authored credit(s) link a ${kindNotice} to media owned by a different user, and a V2 relationship has a single owner, so there is no correct owner to give them: %. Keep the dump and report it; this migration needs an ownership rule before it can run on this data.",
		source: `
			WITH relationship_targets (lot, relationship_schema_slug, relationship_schema_plugin_id) AS (
				VALUES ${buildRelationshipTargetValuesSql(targets)}
			), legacy_people AS (
				SELECT
					legacy_person.id,
					legacy_person.name,
					legacy_person.created_by_user_id AS person_user_id,
					${companyFilterSql} AS is_company
				FROM "person" legacy_person
			)
			SELECT legacy_people.name || ' (owner ' || legacy_people.person_user_id
				|| ') -> ' || metadata.title || ' (owner ' || metadata.created_by_user_id || ')' AS label
			FROM "metadata_to_person" m2p
			INNER JOIN legacy_people ON legacy_people.id = m2p.person_id
			INNER JOIN "metadata" metadata ON metadata.id = m2p.metadata_id
			INNER JOIN relationship_targets ON relationship_targets.lot = metadata.lot
			WHERE legacy_people.is_company = ${isCompanyFilter}
				AND legacy_people.person_user_id IS NOT NULL
				AND metadata.created_by_user_id IS NOT NULL
				AND legacy_people.person_user_id <> metadata.created_by_user_id
		`,
	})}

	WITH relationship_targets (lot, relationship_schema_slug, relationship_schema_plugin_id) AS (
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
			relationship_targets.relationship_schema_slug,
			relationship_targets.relationship_schema_plugin_id
		FROM "metadata_to_person" m2p
		INNER JOIN legacy_people ON legacy_people.id = m2p.person_id
		INNER JOIN "metadata" metadata ON metadata.id = m2p.metadata_id
		INNER JOIN relationship_targets ON relationship_targets.lot = metadata.lot
		WHERE legacy_people.is_company = ${isCompanyFilter}
			AND (legacy_people.person_user_id IS NOT NULL OR metadata.created_by_user_id IS NOT NULL)
	), role_groups AS (
		SELECT
			metadata_id, person_id, relationship_schema_slug, relationship_schema_plugin_id, user_id, role,
			MIN(COALESCE(credit_index, 2147483647)) AS role_order
		FROM legacy_relationships
		GROUP BY metadata_id, person_id, relationship_schema_slug, relationship_schema_plugin_id, user_id, role
	), roles_rollup AS (
		SELECT
			metadata_id, person_id, relationship_schema_slug, relationship_schema_plugin_id, user_id,
			jsonb_agg(role ORDER BY role_order, role) AS roles
		FROM role_groups
		GROUP BY metadata_id, person_id, relationship_schema_slug, relationship_schema_plugin_id, user_id
	), rollups AS (
		SELECT
			metadata_id, person_id, relationship_schema_slug, relationship_schema_plugin_id, user_id,
			MIN(COALESCE(credit_index, 2147483647)) AS relationship_order,
			(
				array_agg("character" ORDER BY COALESCE(credit_index, 2147483647), role)
				FILTER (WHERE "character" IS NOT NULL)
			)[1] AS character
		FROM legacy_relationships
		GROUP BY metadata_id, person_id, relationship_schema_slug, relationship_schema_plugin_id, user_id
	)
	INSERT INTO relationship (
		"id",
		"source_entity_id",
		"target_entity_id",
		"relationship_schema_slug",
		"relationship_schema_plugin_id",
		"properties",
		"user_id",
		"created_at"
	)
	SELECT
		gen_random_uuid()::text,
		rollups.person_id,
		rollups.metadata_id,
		rollups.relationship_schema_slug,
		rollups.relationship_schema_plugin_id,
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
		AND rollups.relationship_schema_slug = roles_rollup.relationship_schema_slug
		AND rollups.relationship_schema_plugin_id IS NOT DISTINCT FROM roles_rollup.relationship_schema_plugin_id
		AND rollups.user_id IS NOT DISTINCT FROM roles_rollup.user_id
	INNER JOIN "entity" src ON src.id = rollups.person_id
	INNER JOIN "entity" tgt ON tgt.id = rollups.metadata_id
	WHERE rollups.user_id IS NOT NULL
	ON CONFLICT ("user_id", "source_entity_id", "target_entity_id", "relationship_schema_slug", "relationship_schema_plugin_id") DO NOTHING;
	GET DIAGNOSTICS rows_inserted = ROW_COUNT;

	${buildReportSql(`${kindNotice} -> relationship`, [{ count: "rows_inserted", message: "user-authored row(s) migrated" }])}
END $$;
`;
};

export const buildLegacyGroupPersonRelationshipInsertSql = (
	targets: ResolvedRelationshipTarget[],
) => `
DO $$
DECLARE
	rows_inserted int;
	cross_owner_rows int := 0;
	cross_owner_sample text;
	started_at timestamptz := clock_timestamp();
BEGIN
	${buildAbortOnRowsSql({
		countVariable: "cross_owner_rows",
		sampleVariable: "cross_owner_sample",
		message:
			"group_person -> relationship: % user-authored credit(s) link a person to a group owned by a different user, and a V2 relationship has a single owner, so there is no correct owner to give them: %. Keep the dump and report it; this migration needs an ownership rule before it can run on this data.",
		source: `
			WITH relationship_targets (lot, relationship_schema_slug, relationship_schema_plugin_id) AS (
				VALUES ${buildRelationshipTargetValuesSql(targets)}
			)
			SELECT legacy_person.name || ' (owner ' || legacy_person.created_by_user_id
				|| ') -> ' || mg.title || ' (owner ' || mg.created_by_user_id || ')' AS label
			FROM "metadata_group_to_person" mg2p
			INNER JOIN "metadata_group" mg ON mg.id = mg2p.metadata_group_id
			INNER JOIN relationship_targets ON relationship_targets.lot = mg.lot
			INNER JOIN "person" legacy_person ON legacy_person.id = mg2p.person_id
			WHERE legacy_person.created_by_user_id IS NOT NULL
				AND mg.created_by_user_id IS NOT NULL
				AND legacy_person.created_by_user_id <> mg.created_by_user_id
		`,
	})}

	WITH relationship_targets (lot, relationship_schema_slug, relationship_schema_plugin_id) AS (
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
			relationship_targets.relationship_schema_slug,
			relationship_targets.relationship_schema_plugin_id
		FROM "metadata_group_to_person" mg2p
		INNER JOIN "metadata_group" mg ON mg.id = mg2p.metadata_group_id
		INNER JOIN relationship_targets ON relationship_targets.lot = mg.lot
		INNER JOIN "person" legacy_person ON legacy_person.id = mg2p.person_id
		WHERE legacy_person.created_by_user_id IS NOT NULL OR mg.created_by_user_id IS NOT NULL
	), role_groups AS (
		SELECT
			metadata_group_id, person_id, relationship_schema_slug, relationship_schema_plugin_id, user_id, role,
			MIN(COALESCE(credit_index, 2147483647)) AS role_order
		FROM legacy_relationships
		GROUP BY metadata_group_id, person_id, relationship_schema_slug, relationship_schema_plugin_id, user_id, role
	), roles_rollup AS (
		SELECT
			metadata_group_id, person_id, relationship_schema_slug, relationship_schema_plugin_id, user_id,
			jsonb_agg(role ORDER BY role_order, role) AS roles
		FROM role_groups
		GROUP BY metadata_group_id, person_id, relationship_schema_slug, relationship_schema_plugin_id, user_id
	), rollups AS (
		SELECT
			metadata_group_id, person_id, relationship_schema_slug, relationship_schema_plugin_id, user_id,
			MIN(COALESCE(credit_index, 2147483647)) AS relationship_order
		FROM legacy_relationships
		GROUP BY metadata_group_id, person_id, relationship_schema_slug, relationship_schema_plugin_id, user_id
	)
	INSERT INTO relationship (
		"id",
		"source_entity_id",
		"target_entity_id",
		"relationship_schema_slug",
		"relationship_schema_plugin_id",
		"properties",
		"user_id",
		"created_at"
	)
	SELECT
		gen_random_uuid()::text,
		rollups.person_id,
		rollups.metadata_group_id,
		rollups.relationship_schema_slug,
		rollups.relationship_schema_plugin_id,
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
		AND rollups.relationship_schema_slug = roles_rollup.relationship_schema_slug
		AND rollups.relationship_schema_plugin_id IS NOT DISTINCT FROM roles_rollup.relationship_schema_plugin_id
		AND rollups.user_id IS NOT DISTINCT FROM roles_rollup.user_id
	INNER JOIN "entity" src ON src.id = rollups.person_id
	INNER JOIN "entity" tgt ON tgt.id = rollups.metadata_group_id
	WHERE rollups.user_id IS NOT NULL
	ON CONFLICT ("user_id", "source_entity_id", "target_entity_id", "relationship_schema_slug", "relationship_schema_plugin_id") DO NOTHING;
	GET DIAGNOSTICS rows_inserted = ROW_COUNT;

	${buildReportSql("group_person -> relationship", [{ count: "rows_inserted", message: "user-authored row(s) migrated" }])}
END $$;
`;
