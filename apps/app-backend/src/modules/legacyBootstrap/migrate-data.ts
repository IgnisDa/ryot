import { and, eq, isNull, sql } from "drizzle-orm";

import type { DbClient } from "~/lib/db";
import { entitySchema, relationshipSchema, sandboxScript } from "~/lib/db/schema";

import {
	buildMetadataGroupEntityMigrationSql,
	buildMetadataGroupRelationshipMigrationSql,
	getUnsupportedMetadataGroupSources,
	metadataGroupEntityTargets,
	metadataGroupRelationshipTargets,
} from "./metadata-group-mapping";
import {
	buildMetadataMigrationSql,
	getUnsupportedMetadataSources,
	metadataMigrationTargets,
} from "./metadata-mapping";
import { buildUniqueSlugMap, shouldRunLegacyBootstrap } from "./shared";

const migrateUserTableSql = sql`
DO $$
BEGIN
	IF to_regclass('"old_user"') IS NULL THEN
		RETURN;
	END IF;

	WITH legacy_users AS (
		SELECT
			old_user.id,
			old_user.name,
			old_user.preferences,
			old_user.created_on,
			old_user.last_login_on,
			nullif(regexp_replace(lower(old_user.name), '[^a-z0-9._%+-]+', '', 'g'), '') AS email_local_part,
			count(*) OVER (
				PARTITION BY nullif(regexp_replace(lower(old_user.name), '[^a-z0-9._%+-]+', '', 'g'), '')
			) AS email_local_part_count
		FROM old_user
	)
	INSERT INTO "user" (
		"id",
		"name",
		"email",
		"preferences",
		"email_verified",
		"created_at",
		"updated_at"
	)
	SELECT
		legacy_users.id,
		legacy_users.name,
		CASE
			WHEN legacy_users.email_local_part_count > 1 AND legacy_users.email_local_part IS NOT NULL THEN
				legacy_users.email_local_part || '+' || legacy_users.id || '@ryot.local'
			ELSE
				COALESCE(legacy_users.email_local_part, legacy_users.id) || '@ryot.local'
		END,
		jsonb_build_object(
			'isNsfw', COALESCE((legacy_users.preferences -> 'general' ->> 'display_nsfw')::boolean, false),
			'languages', jsonb_build_object(
				'providers', COALESCE(
					(
						SELECT jsonb_agg(
							jsonb_build_object(
								'source', provider.value ->> 'source',
								'preferredLanguage', provider.value ->> 'preferred_language'
							)
							ORDER BY provider.ordinality
						)
						FROM jsonb_array_elements(
							COALESCE(legacy_users.preferences -> 'languages' -> 'providers', '[]'::jsonb)
						) WITH ORDINALITY AS provider(value, ordinality)
					),
					'[]'::jsonb
				)
			)
		),
		true,
		legacy_users.created_on,
		COALESCE(legacy_users.last_login_on, legacy_users.created_on)
	FROM legacy_users
	ON CONFLICT ("id") DO NOTHING;
END $$;
`;

export const migrateLegacyTables = async (database: DbClient) => {
	if (!(await shouldRunLegacyBootstrap(database))) {
		return;
	}

	const entitySchemas = await database
		.select({
			id: entitySchema.id,
			slug: entitySchema.slug,
		})
		.from(entitySchema)
		.where(isNull(entitySchema.userId));

	const sandboxScripts = await database
		.select({
			id: sandboxScript.id,
			slug: sandboxScript.slug,
		})
		.from(sandboxScript)
		.where(and(isNull(sandboxScript.userId), eq(sandboxScript.isBuiltin, true)));

	const relationshipSchemas = await database
		.select({
			id: relationshipSchema.id,
			slug: relationshipSchema.slug,
		})
		.from(relationshipSchema)
		.where(isNull(relationshipSchema.userId));

	const entitySchemaIds = buildUniqueSlugMap(entitySchemas, "entity schema");
	const sandboxScriptIds = buildUniqueSlugMap(sandboxScripts, "sandbox script");
	const relationshipSchemaIds = buildUniqueSlugMap(relationshipSchemas, "relationship schema");

	const resolvedMetadataTargets = metadataMigrationTargets.map((target) => {
		const entitySchemaId = entitySchemaIds.get(target.entitySchemaSlug);
		if (entitySchemaId === undefined) {
			throw new Error(`Missing entity schema id for slug "${target.entitySchemaSlug}"`);
		}

		const sandboxScriptId: string | null =
			target.sandboxScriptSlug === null
				? null
				: (sandboxScriptIds.get(target.sandboxScriptSlug) ?? null);
		if (target.sandboxScriptSlug !== null && sandboxScriptId === null) {
			throw new Error(`Missing sandbox script id for slug "${target.sandboxScriptSlug}"`);
		}

		return {
			entitySchemaId,
			sandboxScriptId,
			lot: target.lot,
			source: target.source,
		};
	});

	const resolvedMetadataGroupEntityTargets = metadataGroupEntityTargets.map((target) => {
		const entitySchemaId = entitySchemaIds.get(target.entitySchemaSlug);
		if (entitySchemaId === undefined) {
			throw new Error(`Missing entity schema id for group slug "${target.entitySchemaSlug}"`);
		}

		const sandboxScriptId: string | null =
			target.sandboxScriptSlug === null
				? null
				: (sandboxScriptIds.get(target.sandboxScriptSlug) ?? null);
		if (target.sandboxScriptSlug !== null && sandboxScriptId === null) {
			throw new Error(`Missing sandbox script id for group slug "${target.sandboxScriptSlug}"`);
		}

		return {
			entitySchemaId,
			sandboxScriptId,
			lot: target.lot,
			source: target.source,
		};
	});

	const resolvedMetadataGroupRelationshipTargets = metadataGroupRelationshipTargets.map(
		(target) => {
			const relationshipSchemaId = relationshipSchemaIds.get(target.relationshipSchemaSlug);
			if (relationshipSchemaId === undefined) {
				throw new Error(
					`Missing relationship schema id for slug "${target.relationshipSchemaSlug}"`,
				);
			}

			return { lot: target.lot, relationshipSchemaId };
		},
	);

	const unsupportedMetadataSources = await getUnsupportedMetadataSources(database);
	if (unsupportedMetadataSources.length > 0) {
		throw new Error(
			`Unsupported legacy metadata sources: ${unsupportedMetadataSources
				.map(({ lot, source }) => `${lot}|${source}`)
				.join(", ")}`,
		);
	}

	const unsupportedMetadataGroupSources = await getUnsupportedMetadataGroupSources(database);
	if (unsupportedMetadataGroupSources.length > 0) {
		throw new Error(
			`Unsupported legacy metadata group sources: ${unsupportedMetadataGroupSources
				.map(({ lot, source }) => `${lot}|${source}`)
				.join(", ")}`,
		);
	}

	await database.execute(buildMetadataMigrationSql(resolvedMetadataTargets));
	await database.execute(buildMetadataGroupEntityMigrationSql(resolvedMetadataGroupEntityTargets));
	await database.execute(
		buildMetadataGroupRelationshipMigrationSql(resolvedMetadataGroupRelationshipTargets),
	);
	await database.execute(migrateUserTableSql);
};
