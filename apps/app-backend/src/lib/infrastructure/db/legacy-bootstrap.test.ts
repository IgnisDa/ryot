import { expect, it } from "@effect/vitest";

import { buildLegacyEpisodicSubEntityMigrationSql } from "#modules/legacy-bootstrap/episodic-sub-entity-mapping";
import { buildReviewMigrationSql } from "#modules/legacy-bootstrap/review-mapping";
import { buildSeenEpisodicCompletionMigrationSql } from "#modules/legacy-bootstrap/seen-completion-mapping";
import { buildSeenMigrationSql } from "#modules/legacy-bootstrap/seen-mapping";

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
