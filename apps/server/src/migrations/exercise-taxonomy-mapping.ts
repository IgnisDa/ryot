import { exerciseEquipmentCatalog, exerciseTargetCatalog } from "@ryot-app/fitness-plugin/taxonomy";

import type { QualifiedSchema } from "./migration-resolution";
import type { ResolvedEntityMigrationTarget } from "./shared";
import {
	buildAbortOnRowsSql,
	buildEntityTargetValuesSql,
	buildRequireLegacyTableSql,
	buildReportSql,
	quoteNullableSqlString,
	quoteSqlString,
} from "./shared";

type ExerciseTaxonomyMigrationInput = {
	fitnessPluginId: string;
	targetProviderId: string;
	equipmentProviderId: string;
	targetEntitySchema: QualifiedSchema;
	exerciseEntitySchema: QualifiedSchema;
	equipmentEntitySchema: QualifiedSchema;
	targetRelationshipSchema: QualifiedSchema;
	equipmentRelationshipSchema: QualifiedSchema;
	exerciseTargets: ResolvedEntityMigrationTarget[];
};

const buildCatalogValuesSql = (
	catalog: ReadonlyArray<{ name: string; externalId: string; properties: object }>,
) =>
	catalog
		.map(({ name, externalId, properties }) => {
			return `(${quoteSqlString(externalId)}, ${quoteSqlString(name)}, ${quoteSqlString(JSON.stringify(properties))}::jsonb)`;
		})
		.join(", ");

const buildExternalIdValuesSql = (externalIds: ReadonlyArray<string>) =>
	externalIds.map((externalId) => `(${quoteSqlString(externalId)})`).join(", ");

export const buildExerciseTaxonomyMigrationSql = (input: ExerciseTaxonomyMigrationInput) => {
	const exerciseTargetValuesSql = buildEntityTargetValuesSql(input.exerciseTargets);
	const targetCatalogValuesSql = buildCatalogValuesSql(exerciseTargetCatalog);
	const equipmentCatalogValuesSql = buildCatalogValuesSql(exerciseEquipmentCatalog);
	const targetExternalIdValuesSql = buildExternalIdValuesSql(
		exerciseTargetCatalog.map(({ externalId }) => externalId),
	);
	const equipmentExternalIdValuesSql = buildExternalIdValuesSql(
		exerciseEquipmentCatalog.map(({ externalId }) => externalId),
	);
	const targetIdentityPrefix = `legacy-exercise-taxonomy:${input.fitnessPluginId}:${input.targetEntitySchema.slug}:`;
	const equipmentIdentityPrefix = `legacy-exercise-taxonomy:${input.fitnessPluginId}:${input.equipmentEntitySchema.slug}:`;
	const targetRelationshipIdPrefix = `legacy-exercise-taxonomy-link:${input.fitnessPluginId}:${input.targetRelationshipSchema.slug}:${input.targetRelationshipSchema.pluginId}:`;
	const equipmentRelationshipIdPrefix = `legacy-exercise-taxonomy-link:${input.fitnessPluginId}:${input.equipmentRelationshipSchema.slug}:${input.equipmentRelationshipSchema.pluginId}:`;

	return `
DO $$
DECLARE
	invalid_taxonomy_values int;
	taxonomy_entity_count bigint;
	invalid_taxonomy_value_sample text;
	taxonomy_relationship_count bigint;
	deterministic_entity_conflicts int;
	deterministic_relationship_conflicts int;
	deterministic_entity_conflict_sample text;
	started_at timestamptz := clock_timestamp();
	deterministic_relationship_conflict_sample text;
BEGIN
	${buildRequireLegacyTableSql("exercise -> taxonomy", "exercise")}

	${buildAbortOnRowsSql({
		countVariable: "invalid_taxonomy_values",
		sampleVariable: "invalid_taxonomy_value_sample",
		message:
			"exercise -> taxonomy: % exercise entity row(s) are missing or have conflicting identity, provenance, or ownership: %. Keep the dump and report this migration conflict; taxonomy memberships cannot be attributed safely.",
		source: `
			SELECT exercise.id::text AS label
			FROM "exercise" exercise
			INNER JOIN (VALUES ${exerciseTargetValuesSql}) AS target (
				source, entity_schema_slug, entity_schema_plugin_id, provider_id
			) ON target.source = exercise.source
			LEFT JOIN "entity" existing ON existing.id = exercise.id
			WHERE (exercise.source = 'github' OR exercise.created_by_user_id IS NOT NULL)
				AND (
					existing.id IS NULL
					OR existing.external_id IS DISTINCT FROM exercise.id::text
					OR existing.entity_schema_slug IS DISTINCT FROM target.entity_schema_slug
					OR existing.entity_schema_plugin_id IS DISTINCT FROM target.entity_schema_plugin_id
					OR existing.provider_id IS DISTINCT FROM target.provider_id
					OR existing.user_id IS DISTINCT FROM exercise.created_by_user_id
				)
		`,
	})}

	CREATE TEMP TABLE _legacy_exercise_taxonomy_exercises ON COMMIT DROP AS
	SELECT
		exercise.id::text AS exercise_id,
		exercise.source,
		exercise_entity.user_id::text AS user_id,
		exercise.muscles,
		exercise.equipment::text AS equipment
	FROM "exercise" exercise
	INNER JOIN (VALUES ${exerciseTargetValuesSql}) AS exercise_targets (
		source,
		entity_schema_slug,
		entity_schema_plugin_id,
		provider_id
	) ON exercise_targets.source = exercise.source
	INNER JOIN "entity" exercise_entity
		ON exercise_entity.id::text = exercise.id::text
		AND exercise_entity.external_id IS NOT DISTINCT FROM exercise.id::text
		AND exercise_entity.entity_schema_slug = exercise_targets.entity_schema_slug
		AND exercise_entity.entity_schema_plugin_id IS NOT DISTINCT FROM exercise_targets.entity_schema_plugin_id
		AND exercise_entity.provider_id IS NOT DISTINCT FROM exercise_targets.provider_id
		AND exercise_entity.user_id IS NOT DISTINCT FROM CASE
			WHEN exercise.source = 'github' THEN NULL
			ELSE exercise.created_by_user_id
		END
	WHERE exercise_entity.entity_schema_slug = ${quoteSqlString(input.exerciseEntitySchema.slug)}
		AND exercise_entity.entity_schema_plugin_id IS NOT DISTINCT FROM ${quoteNullableSqlString(input.exerciseEntitySchema.pluginId)};

	${buildAbortOnRowsSql({
		countVariable: "invalid_taxonomy_values",
		sampleVariable: "invalid_taxonomy_value_sample",
		message:
			"exercise -> taxonomy: % malformed muscle or equipment value(s) do not match the fitness taxonomy catalog, so the migration cannot preserve those memberships: %. Replace them with exact catalog tokens, then start the server again.",
		source: `
			SELECT invalid.label
			FROM (
				SELECT
					exercise.exercise_id || ' muscle[' || muscle.ordinality::text || ']='
						|| COALESCE(LEFT(muscle.value::text, 100), '<null>') AS label
				FROM _legacy_exercise_taxonomy_exercises exercise
				CROSS JOIN LATERAL unnest(exercise.muscles) WITH ORDINALITY AS muscle(value, ordinality)
				WHERE exercise.source IN ('custom', 'github')
					AND (
						muscle.value IS NULL
						OR BTRIM(muscle.value::text) = ''
						OR NOT EXISTS (
							SELECT 1 FROM (VALUES ${targetExternalIdValuesSql}) AS target_catalog(external_id)
							WHERE target_catalog.external_id = muscle.value::text
						)
					)

				UNION ALL

				SELECT
					exercise.exercise_id || ' equipment='
						|| COALESCE(LEFT(exercise.equipment::text, 100), '<null>') AS label
				FROM _legacy_exercise_taxonomy_exercises exercise
				WHERE exercise.source IN ('custom', 'github')
					AND exercise.equipment IS NOT NULL
					AND (
						BTRIM(exercise.equipment::text) = ''
						OR NOT EXISTS (
							SELECT 1 FROM (VALUES ${equipmentExternalIdValuesSql}) AS equipment_catalog(external_id)
							WHERE equipment_catalog.external_id = CASE exercise.equipment::text
								WHEN 'e_z_curl_bar' THEN 'ez_curl_bar'
								ELSE exercise.equipment::text
							END
						)
					)
			) invalid
		`,
	})}

	CREATE TEMP TABLE _legacy_exercise_taxonomy_nodes ON COMMIT DROP AS
	WITH target_catalog (external_id, name, properties) AS (
		VALUES ${targetCatalogValuesSql}
	), equipment_catalog (external_id, name, properties) AS (
		VALUES ${equipmentCatalogValuesSql}
	), used_targets AS (
		SELECT DISTINCT muscle.value::text AS external_id
		FROM _legacy_exercise_taxonomy_exercises exercise
		CROSS JOIN LATERAL unnest(exercise.muscles) AS muscle(value)
	), used_equipment AS (
		SELECT DISTINCT CASE exercise.equipment
			WHEN 'e_z_curl_bar' THEN 'ez_curl_bar'
			ELSE exercise.equipment
		END AS external_id
		FROM _legacy_exercise_taxonomy_exercises exercise
		WHERE exercise.equipment IS NOT NULL
	)
	SELECT
		'target'::text AS taxonomy_kind,
		catalog.external_id,
		catalog.name,
		catalog.properties,
		${quoteSqlString(input.targetEntitySchema.slug)} AS entity_schema_slug,
		${quoteNullableSqlString(input.targetEntitySchema.pluginId)} AS entity_schema_plugin_id,
		${quoteSqlString(input.targetProviderId)} AS provider_id,
		md5(${quoteSqlString(targetIdentityPrefix)} || catalog.external_id) AS deterministic_id
	FROM target_catalog catalog
	INNER JOIN used_targets used ON used.external_id = catalog.external_id

	UNION ALL

	SELECT
		'equipment'::text AS taxonomy_kind,
		catalog.external_id,
		catalog.name,
		catalog.properties,
		${quoteSqlString(input.equipmentEntitySchema.slug)} AS entity_schema_slug,
		${quoteNullableSqlString(input.equipmentEntitySchema.pluginId)} AS entity_schema_plugin_id,
		${quoteSqlString(input.equipmentProviderId)} AS provider_id,
		md5(${quoteSqlString(equipmentIdentityPrefix)} || catalog.external_id) AS deterministic_id
	FROM equipment_catalog catalog
	INNER JOIN used_equipment used ON used.external_id = catalog.external_id;

	${buildAbortOnRowsSql({
		countVariable: "deterministic_entity_conflicts",
		sampleVariable: "deterministic_entity_conflict_sample",
		message:
			"exercise -> taxonomy: % deterministic taxonomy entity ID(s) are already used by rows with different identity, provenance, or ownership: %. Keep the dump and report this migration conflict; retrying will not change it.",
		source: `
			SELECT existing.id::text AS label
			FROM _legacy_exercise_taxonomy_nodes node
			INNER JOIN "entity" existing ON existing.id = node.deterministic_id
			WHERE existing.external_id IS DISTINCT FROM node.external_id
				OR existing.entity_schema_slug IS DISTINCT FROM node.entity_schema_slug
				OR existing.entity_schema_plugin_id IS DISTINCT FROM node.entity_schema_plugin_id
				OR existing.provider_id IS DISTINCT FROM node.provider_id
				OR existing.user_id IS NOT NULL
		`,
	})}

	SELECT COUNT(*) INTO taxonomy_entity_count FROM _legacy_exercise_taxonomy_nodes;

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
		node.deterministic_id,
		node.external_id,
		node.name,
		NOW(),
		NOW(),
		NULL,
		node.properties,
		node.entity_schema_slug,
		node.entity_schema_plugin_id,
		node.provider_id,
		NOW()
	FROM _legacy_exercise_taxonomy_nodes node
	WHERE NOT EXISTS (
		SELECT 1
		FROM "entity" existing
		WHERE existing.external_id = node.external_id
			AND existing.entity_schema_slug = node.entity_schema_slug
			AND existing.entity_schema_plugin_id IS NOT DISTINCT FROM node.entity_schema_plugin_id
			AND existing.provider_id IS NOT DISTINCT FROM node.provider_id
			AND existing.user_id IS NULL
	)
	ON CONFLICT DO NOTHING;

	UPDATE "entity" existing
	SET
		"name" = node.name,
		"properties" = node.properties,
		"populated_at" = NOW(),
		"updated_at" = NOW()
	FROM _legacy_exercise_taxonomy_nodes node
	WHERE existing.external_id = node.external_id
		AND existing.entity_schema_slug = node.entity_schema_slug
		AND existing.entity_schema_plugin_id IS NOT DISTINCT FROM node.entity_schema_plugin_id
		AND existing.provider_id IS NOT DISTINCT FROM node.provider_id
		AND existing.user_id IS NULL
		AND existing.populated_at IS NULL;

	CREATE TEMP TABLE _legacy_exercise_taxonomy_relationships ON COMMIT DROP AS
	WITH target_memberships AS (
		SELECT DISTINCT exercise.exercise_id, exercise.user_id, muscle.value::text AS external_id
		FROM _legacy_exercise_taxonomy_exercises exercise
		CROSS JOIN LATERAL unnest(exercise.muscles) AS muscle(value)
	), equipment_memberships AS (
		SELECT DISTINCT
			exercise.exercise_id,
			exercise.user_id,
			CASE exercise.equipment
				WHEN 'e_z_curl_bar' THEN 'ez_curl_bar'
				ELSE exercise.equipment
			END AS external_id
		FROM _legacy_exercise_taxonomy_exercises exercise
		WHERE exercise.equipment IS NOT NULL
	)
	SELECT
		membership.user_id,
		membership.exercise_id AS source_entity_id,
		target.id AS target_entity_id,
		${quoteSqlString(input.targetRelationshipSchema.slug)} AS relationship_schema_slug,
		${quoteNullableSqlString(input.targetRelationshipSchema.pluginId)} AS relationship_schema_plugin_id,
		md5(
			${quoteSqlString(targetRelationshipIdPrefix)}
			|| COALESCE(membership.user_id, '<global>') || ':'
			|| membership.exercise_id || ':' || target.id || ':'
			|| ${quoteNullableSqlString(input.targetRelationshipSchema.pluginId)}
		) AS deterministic_id
	FROM target_memberships membership
	INNER JOIN _legacy_exercise_taxonomy_nodes node
		ON node.taxonomy_kind = 'target'
		AND node.external_id = membership.external_id
	INNER JOIN "entity" target
		ON target.external_id = node.external_id
		AND target.entity_schema_slug = node.entity_schema_slug
		AND target.entity_schema_plugin_id IS NOT DISTINCT FROM node.entity_schema_plugin_id
		AND target.provider_id IS NOT DISTINCT FROM node.provider_id
		AND target.user_id IS NULL

	UNION ALL

	SELECT
		membership.user_id,
		membership.exercise_id AS source_entity_id,
		equipment.id AS target_entity_id,
		${quoteSqlString(input.equipmentRelationshipSchema.slug)} AS relationship_schema_slug,
		${quoteNullableSqlString(input.equipmentRelationshipSchema.pluginId)} AS relationship_schema_plugin_id,
		md5(
			${quoteSqlString(equipmentRelationshipIdPrefix)}
			|| COALESCE(membership.user_id, '<global>') || ':'
			|| membership.exercise_id || ':' || equipment.id || ':'
			|| ${quoteNullableSqlString(input.equipmentRelationshipSchema.pluginId)}
		) AS deterministic_id
	FROM equipment_memberships membership
	INNER JOIN _legacy_exercise_taxonomy_nodes node
		ON node.taxonomy_kind = 'equipment'
		AND node.external_id = membership.external_id
	INNER JOIN "entity" equipment
		ON equipment.external_id = node.external_id
		AND equipment.entity_schema_slug = node.entity_schema_slug
		AND equipment.entity_schema_plugin_id IS NOT DISTINCT FROM node.entity_schema_plugin_id
		AND equipment.provider_id IS NOT DISTINCT FROM node.provider_id
		AND equipment.user_id IS NULL;

	${buildAbortOnRowsSql({
		countVariable: "deterministic_relationship_conflicts",
		sampleVariable: "deterministic_relationship_conflict_sample",
		message:
			"exercise -> taxonomy: % deterministic taxonomy relationship ID(s) are already used by rows with different endpoints, schema provenance, or ownership: %. Keep the dump and report this migration conflict; retrying will not change it.",
		source: `
			SELECT existing.id::text AS label
			FROM _legacy_exercise_taxonomy_relationships intended
			INNER JOIN "relationship" existing ON existing.id = intended.deterministic_id
			WHERE existing.user_id IS DISTINCT FROM intended.user_id
				OR existing.source_entity_id IS DISTINCT FROM intended.source_entity_id
				OR existing.target_entity_id IS DISTINCT FROM intended.target_entity_id
				OR existing.relationship_schema_slug IS DISTINCT FROM intended.relationship_schema_slug
				OR existing.relationship_schema_plugin_id IS DISTINCT FROM intended.relationship_schema_plugin_id
		`,
	})}

	SELECT COUNT(*) INTO taxonomy_relationship_count
	FROM _legacy_exercise_taxonomy_relationships;

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
		intended.deterministic_id,
		intended.user_id,
		intended.source_entity_id,
		intended.target_entity_id,
		intended.relationship_schema_slug,
		intended.relationship_schema_plugin_id,
		'{}'::jsonb,
		NOW()
	FROM _legacy_exercise_taxonomy_relationships intended
	WHERE NOT EXISTS (
		SELECT 1
		FROM "relationship" existing
		WHERE existing.user_id IS NOT DISTINCT FROM intended.user_id
			AND existing.source_entity_id = intended.source_entity_id
			AND existing.target_entity_id = intended.target_entity_id
			AND existing.relationship_schema_slug = intended.relationship_schema_slug
			AND existing.relationship_schema_plugin_id IS NOT DISTINCT FROM intended.relationship_schema_plugin_id
	)
	ON CONFLICT DO NOTHING;

	${buildReportSql("exercise taxonomy -> entities and relationships", [
		{ count: "taxonomy_entity_count", message: "standard taxonomy entity(ies) ensured" },
		{ count: "taxonomy_relationship_count", message: "exercise taxonomy relationship(s) ensured" },
	])}
END $$;
`;
};
