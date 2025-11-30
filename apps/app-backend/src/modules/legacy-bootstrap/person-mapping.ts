import { sql } from "drizzle-orm";
import { Effect } from "effect";

import { dbEffect, DbService } from "#lib/infrastructure/db/service";

import {
	buildLegacyEntityMigrationSql,
	legacyPersonCompanyPredicateSql,
} from "./person-mapping-entity-sql";
import {
	buildLegacyGroupPersonRelationshipInsertSql,
	buildLegacyRelationshipInsertSql,
} from "./person-mapping-relationship-sql";
import type {
	EntityMigrationTarget,
	ResolvedEntityMigrationTarget,
	ResolvedRelationshipTarget,
} from "./shared";

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
	{ source: "music_brainz", entitySchemaSlug: "person", sandboxScriptSlug: "person.music-brainz" },
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
	{ source: "igdb", entitySchemaSlug: "company", sandboxScriptSlug: "company.igdb" },
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

export const buildPersonEntityMigrationSql = (targets: ResolvedEntityMigrationTarget[]) =>
	buildLegacyEntityMigrationSql({ kind: "person", targets });

export const buildCompanyEntityMigrationSql = (targets: ResolvedEntityMigrationTarget[]) =>
	buildLegacyEntityMigrationSql({ kind: "company", targets });

export const buildPersonRelationshipMigrationSql = (targets: ResolvedRelationshipTarget[]) =>
	buildLegacyRelationshipInsertSql({ kind: "person", targets });

export const buildCompanyRelationshipMigrationSql = (targets: ResolvedRelationshipTarget[]) =>
	buildLegacyRelationshipInsertSql({ kind: "company", targets });

export const buildGroupPersonRelationshipMigrationSql = (targets: ResolvedRelationshipTarget[]) =>
	buildLegacyGroupPersonRelationshipInsertSql(targets);

export const getUnsupportedPersonSources = Effect.gen(function* () {
	const { db } = yield* DbService;
	const result = yield* dbEffect(() =>
		db.execute<{ source: string; entity_kind: string }>(sql`
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
		`),
	);

	return result.rows;
});
