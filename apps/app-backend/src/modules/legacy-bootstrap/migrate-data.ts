import { and, eq, isNull } from "drizzle-orm";

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
import {
	buildCompanyEntityMigrationSql,
	buildCompanyRelationshipMigrationSql,
	buildPersonEntityMigrationSql,
	buildPersonRelationshipMigrationSql,
	companyEntityTargets,
	getUnsupportedPersonSources,
	personEntityTargets,
} from "./person-mapping";
import {
	buildUniqueSlugMap,
	shouldRunLegacyBootstrap,
	withLegacyBootstrapNoticeClient,
} from "./shared";

const migrateUserTableSql = `
DO $$
DECLARE
	rows_inserted int;
	started_at timestamptz := clock_timestamp();
BEGIN
	IF to_regclass('"old_user"') IS NULL THEN
		RETURN;
	END IF;

	RAISE NOTICE 'old_user -> user: migration started (% seconds elapsed)', 0.0;

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
	GET DIAGNOSTICS rows_inserted = ROW_COUNT;
	RAISE NOTICE 'old_user -> user: % row(s) migrated (% seconds elapsed)',
		rows_inserted,
		round(extract(epoch from clock_timestamp() - started_at)::numeric, 1);
END $$;
`;

const buildUniqueLotEntitySchemaSlugMap = (
	targets: readonly { lot: string; entitySchemaSlug: string }[],
) => {
	const lotToEntitySchemaSlug = new Map<string, string>();
	for (const target of targets) {
		const existing = lotToEntitySchemaSlug.get(target.lot);
		if (existing !== undefined && existing !== target.entitySchemaSlug) {
			throw new Error(
				`Conflicting entity schema slugs for legacy lot "${target.lot}" (${existing} vs ${target.entitySchemaSlug})`,
			);
		}

		lotToEntitySchemaSlug.set(target.lot, target.entitySchemaSlug);
	}

	return lotToEntitySchemaSlug;
};

const resolveEntityMigrationTargets = <
	T extends { source: string; entitySchemaSlug: string; sandboxScriptSlug: string | null },
>(
	targets: readonly T[],
	entitySchemaIds: Map<string, string>,
	sandboxScriptIds: Map<string, string>,
	kindLabel: string,
): Array<T & { entitySchemaId: string; sandboxScriptId: string | null }> =>
	targets.map((target) => {
		const entitySchemaId = entitySchemaIds.get(target.entitySchemaSlug);
		if (entitySchemaId === undefined) {
			throw new Error(
				`Missing entity schema id for ${kindLabel} slug "${target.entitySchemaSlug}"`,
			);
		}

		const sandboxScriptId: string | null =
			target.sandboxScriptSlug === null
				? null
				: (sandboxScriptIds.get(target.sandboxScriptSlug) ?? null);
		if (target.sandboxScriptSlug !== null && sandboxScriptId === null) {
			throw new Error(`Missing sandbox script id for slug "${target.sandboxScriptSlug}"`);
		}

		return {
			...target,
			entitySchemaId,
			sandboxScriptId,
		};
	});

const resolveRelationshipMigrationTargets = (input: {
	sourceEntitySchemaSlug: "person" | "company";
	lotToEntitySchemaSlug: Map<string, string>;
	relationshipSchemaIds: Map<string, string>;
}) => {
	const targets: Array<{ lot: string; relationshipSchemaId: string }> = [];

	for (const [lot, targetEntitySchemaSlug] of input.lotToEntitySchemaSlug.entries()) {
		const relationshipSchemaSlug = `${input.sourceEntitySchemaSlug}-to-${targetEntitySchemaSlug}`;
		const relationshipSchemaId = input.relationshipSchemaIds.get(relationshipSchemaSlug);
		if (relationshipSchemaId === undefined) {
			throw new Error(`Missing relationship schema id for slug "${relationshipSchemaSlug}"`);
		}

		targets.push({ lot, relationshipSchemaId });
	}

	return targets;
};

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
	const metadataEntitySchemaSlugByLot = buildUniqueLotEntitySchemaSlugMap(
		metadataMigrationTargets.map(({ lot, entitySchemaSlug }) => ({ lot, entitySchemaSlug })),
	);

	const resolvedMetadataTargets = resolveEntityMigrationTargets(
		metadataMigrationTargets,
		entitySchemaIds,
		sandboxScriptIds,
		"metadata",
	);
	const resolvedMetadataGroupEntityTargets = resolveEntityMigrationTargets(
		metadataGroupEntityTargets,
		entitySchemaIds,
		sandboxScriptIds,
		"metadata group",
	);
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
	const resolvedPersonEntityTargets = resolveEntityMigrationTargets(
		personEntityTargets,
		entitySchemaIds,
		sandboxScriptIds,
		"person",
	);
	const resolvedCompanyEntityTargets = resolveEntityMigrationTargets(
		companyEntityTargets,
		entitySchemaIds,
		sandboxScriptIds,
		"company",
	);
	const resolvedPersonRelationshipTargets = resolveRelationshipMigrationTargets({
		sourceEntitySchemaSlug: "person",
		lotToEntitySchemaSlug: metadataEntitySchemaSlugByLot,
		relationshipSchemaIds,
	});
	const resolvedCompanyRelationshipTargets = resolveRelationshipMigrationTargets({
		sourceEntitySchemaSlug: "company",
		lotToEntitySchemaSlug: metadataEntitySchemaSlugByLot,
		relationshipSchemaIds,
	});

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

	const unsupportedPersonSources = await getUnsupportedPersonSources(database);
	if (unsupportedPersonSources.length > 0) {
		throw new Error(
			`Unsupported legacy person sources: ${unsupportedPersonSources
				.map(({ entity_kind, source }) => `${entity_kind}|${source}`)
				.join(", ")}`,
		);
	}

	await withLegacyBootstrapNoticeClient(database, async (client) => {
		await client.query(buildMetadataMigrationSql(resolvedMetadataTargets));
		await client.query(buildMetadataGroupEntityMigrationSql(resolvedMetadataGroupEntityTargets));
		await client.query(
			buildMetadataGroupRelationshipMigrationSql(resolvedMetadataGroupRelationshipTargets),
		);
		await client.query(migrateUserTableSql);
		await client.query(buildPersonEntityMigrationSql(resolvedPersonEntityTargets));
		await client.query(buildCompanyEntityMigrationSql(resolvedCompanyEntityTargets));
		await client.query(`
			DO $$
			DECLARE
				rec RECORD;
			BEGIN
				FOR rec IN
					SELECT schemaname, tablename
					FROM pg_tables
					WHERE schemaname = ANY (current_schemas(false))
					ORDER BY schemaname, tablename
				LOOP
					EXECUTE format('ANALYZE %I.%I', rec.schemaname, rec.tablename);
				END LOOP;
			END $$;
		`);
		await client.query(buildPersonRelationshipMigrationSql(resolvedPersonRelationshipTargets));
		await client.query(buildCompanyRelationshipMigrationSql(resolvedCompanyRelationshipTargets));
	});
};
