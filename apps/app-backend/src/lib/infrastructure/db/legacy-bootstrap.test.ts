import { assert, expect, it } from "@effect/vitest";

import { buildLegacyEpisodicSubEntityMigrationSql } from "#modules/legacy-bootstrap/episodic-sub-entity-mapping";
import {
	buildExerciseMigrationSql,
	exerciseEntityTargets,
} from "#modules/legacy-bootstrap/exercise-mapping";
import {
	buildMetadataGroupEntityMigrationSql,
	metadataGroupEntityTargets,
} from "#modules/legacy-bootstrap/metadata-group-mapping";
import { buildMetadataMigrationSql } from "#modules/legacy-bootstrap/metadata-mapping";
import { metadataMigrationTargets } from "#modules/legacy-bootstrap/metadata-mapping-targets";
import { resolveEntityMigrationTargets } from "#modules/legacy-bootstrap/migration-resolution";
import {
	buildCompanyEntityMigrationSql,
	buildPersonEntityMigrationSql,
	companyEntityTargets,
	personEntityTargets,
} from "#modules/legacy-bootstrap/person-mapping";
import { buildReviewMigrationSql } from "#modules/legacy-bootstrap/review-mapping";
import { buildSeenEpisodicCompletionMigrationSql } from "#modules/legacy-bootstrap/seen-completion-mapping";
import { buildSeenMigrationSql } from "#modules/legacy-bootstrap/seen-mapping";
import {
	buildEntityTargetValuesSql,
	buildLotEntityTargetValuesSql,
	buildUniqueSlugMap,
} from "#modules/legacy-bootstrap/shared";
import {
	buildWorkoutMigrationSql,
	buildWorkoutSetEventMigrationSql,
	buildWorkoutTemplateMigrationSql,
} from "#modules/legacy-bootstrap/workout-mapping";

const allTargets = [
	...metadataMigrationTargets,
	...metadataGroupEntityTargets,
	...personEntityTargets,
	...companyEntityTargets,
	...exerciseEntityTargets,
];

const entitySchemaSlugs = new Map(
	allTargets.map(({ entitySchemaSlug }) => [entitySchemaSlug, entitySchemaSlug]),
);

const providerIds = new Map(
	allTargets.flatMap(({ providerSlug }) =>
		providerSlug === null ? [] : [[providerSlug, `provider-id:${providerSlug}`] as const],
	),
);

const resolve = <
	T extends { source: string; entitySchemaSlug: string; providerSlug: string | null },
>(
	targets: readonly T[],
	kindLabel: string,
) => resolveEntityMigrationTargets(targets, entitySchemaSlugs, providerIds, kindLabel);

it("keeps post-Drizzle legacy migration SQL independent of dropped definition tables", () => {
	const migrationSql = [
		buildReviewMigrationSql(),
		buildSeenMigrationSql(),
		buildSeenEpisodicCompletionMigrationSql(),
		buildLegacyEpisodicSubEntityMigrationSql({
			showSeasonEntitySchemaSlug: "show-season",
			showEpisodeEntitySchemaSlug: "show-episode",
			podcastEpisodeEntitySchemaSlug: "podcast-episode",
			showToSeasonRelationshipSchemaSlug: "show-to-show-season",
			seasonToEpisodeRelationshipSchemaSlug: "show-season-to-show-episode",
			podcastToEpisodeRelationshipSchemaSlug: "podcast-to-podcast-episode",
		}),
	].join("\n");

	expect(migrationSql).not.toMatch(/"(?:entity|event|relationship)_schema"/);
	expect(migrationSql).toContain("'review'");
	expect(migrationSql).toContain("'progress'");
	expect(migrationSql).toContain("'complete'");
});

it("renders resolved provider ids into the target VALUES tuples", () => {
	const lotValuesSql = buildLotEntityTargetValuesSql(resolve(metadataMigrationTargets, "metadata"));
	const valuesSql = buildEntityTargetValuesSql(resolve(personEntityTargets, "person"));

	expect(lotValuesSql).toContain("('movie', 'tmdb', 'movie', 'provider-id:movie.tmdb')");
	expect(lotValuesSql).toContain("('movie', 'custom', 'movie', NULL)");
	expect(valuesSql).toContain("('tmdb', 'person', 'provider-id:person.tmdb')");
	expect(valuesSql).toContain("('custom', 'person', NULL)");
});

it("writes entity provenance as provider_id and never as sandbox_script_id", () => {
	const migrationSql = [
		buildMetadataMigrationSql(resolve(metadataMigrationTargets, "metadata")),
		buildMetadataGroupEntityMigrationSql(resolve(metadataGroupEntityTargets, "metadata group")),
		buildPersonEntityMigrationSql(resolve(personEntityTargets, "person")),
		buildCompanyEntityMigrationSql(resolve(companyEntityTargets, "company")),
		buildExerciseMigrationSql(resolve(exerciseEntityTargets, "exercise")),
	].join("\n");

	expect(migrationSql).not.toContain("sandbox_script");
	expect(migrationSql).toContain('"provider_id"');
	expect(migrationSql).toContain("provider-id:exercise.free-exercise-db");
	for (const alias of ["metadata_targets", "mgt", "person_targets", "exercise_targets"]) {
		expect(migrationSql).toContain(`${alias}.provider_id`);
	}
});

it("normalizes legacy fitness media for entities, events, and nested template exercises", () => {
	const migrationSql = [
		buildExerciseMigrationSql(resolve(exerciseEntityTargets, "exercise")),
		buildWorkoutMigrationSql("workout"),
		buildWorkoutTemplateMigrationSql("workout-template"),
		buildWorkoutSetEventMigrationSql("workout-set"),
	].join("\n");

	expect(migrationSql).toContain("'images'");
	expect(migrationSql).toContain("'videos'");
	expect(migrationSql).toContain("jsonb_build_object('type', 'remote', 'url', remote_asset)");
	expect(migrationSql).toContain("jsonb_build_object('type', 's3', 'key', s3_asset)");
	expect(migrationSql).toContain(
		"jsonb_build_object('type', 'remote', 'url', remote_video.value ->> 'url')",
	);
	expect(migrationSql).toContain("jsonb_build_object('type', 's3', 'key', s3_video)");
	expect(migrationSql).not.toContain("'s3Images'");
	expect(migrationSql).not.toContain("'s3Videos'");
	expect(migrationSql).not.toContain("'remoteImages'");
	expect(migrationSql).not.toContain("'remoteVideos'");
	expect(migrationSql).not.toContain("'exerciseAssets'");
	expect(migrationSql).not.toContain("lower(rv ->> 'source')");
	expect(migrationSql).not.toContain("'source'");
});

it("fails loud on an unresolvable provider slug and keeps custom targets unprovisioned", () => {
	expect(() =>
		resolveEntityMigrationTargets(
			[{ source: "tmdb", entitySchemaSlug: "movie", providerSlug: "movie.tmdb" }],
			entitySchemaSlugs,
			new Map(),
			"metadata",
		),
	).toThrow('Missing provider id for slug "movie.tmdb"');

	const [resolved] = resolve(
		[{ source: "custom", entitySchemaSlug: "movie", providerSlug: null }],
		"metadata",
	);
	assert(resolved !== undefined);
	expect(resolved.providerId).toBeNull();
});

it("rejects duplicate provider slugs", () => {
	expect(() =>
		buildUniqueSlugMap(
			[
				{ id: "one", slug: "movie.tmdb" },
				{ id: "two", slug: "movie.tmdb" },
			],
			"sandbox provider",
		),
	).toThrow("Duplicate sandbox provider slugs: movie.tmdb");
});
