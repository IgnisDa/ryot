import { Effect } from "effect";
import type * as SqlConnection from "effect/sql/SqlConnection";

import { insertUsers, mediaPluginId } from "./legacy-database.test-support";
import { buildReviewMigrationSql } from "./review-mapping";
import { buildSeenMigrationSql } from "./seen-mapping";

export const seedLegacyHistory = (connection: SqlConnection.Connection) =>
	Effect.gen(function* () {
		yield* insertUsers(connection, ["user-a", "user-b", "user-c", "user-d"]);
		yield* connection.executeRaw(
			`DO $$ BEGIN
			UPDATE "user" SET "disabled_at" = now() WHERE "id" = 'user-d';
			INSERT INTO "sandbox_provider" ("id", "slug", "root_entity_schema_slug", "name", "information", "plugin_id")
			VALUES ('show-tmdb', 'show.tmdb', 'show', '{}', '{}', '${mediaPluginId}');
			INSERT INTO "metadata" ("id", "lot", "source", "identifier", "title", "created_by_user_id")
			VALUES ('show', 'show', 'tmdb', '1399', 'Synthetic Show', NULL),
				('other-show', 'show', 'tmdb', '1400', 'Other Show', NULL),
				('custom-show', 'show', 'custom', 'custom-show', 'Custom Show', 'user-a');
			INSERT INTO "entity" ("id", "external_id", "name", "user_id", "provider_id", "populated_at", "entity_schema_slug", "entity_schema_plugin_id", "properties")
			VALUES ('show', '1399', 'Synthetic Show', NULL, 'show-tmdb', '2024-01-01', 'show', '${mediaPluginId}', '{}'),
				('other-show', '1400', 'Other Show', NULL, 'show-tmdb', '2024-01-01', 'show', '${mediaPluginId}', '{}'),
				('custom-show', NULL, 'Custom Show', 'user-a', NULL, NULL, 'show', '${mediaPluginId}', '{}'),
				('show-s1', '1399-s1', 'Season 1', NULL, 'show-tmdb', '2024-01-01', 'show-season', '${mediaPluginId}', '{"seasonNumber": 1}'),
				('show-s1e1', '1399-s1e1', 'Episode 1', NULL, 'show-tmdb', '2024-01-01', 'show-episode', '${mediaPluginId}', '{"seasonNumber": 1, "episodeNumber": 1}');
			INSERT INTO "relationship" ("id", "source_entity_id", "target_entity_id", "relationship_schema_slug", "relationship_schema_plugin_id")
			VALUES ('show-season', 'show', 'show-s1', 'show-to-show-season', '${mediaPluginId}'),
				('season-episode', 'show-s1', 'show-s1e1', 'show-season-to-show-episode', '${mediaPluginId}');
			INSERT INTO "seen" ("id", "user_id", "metadata_id", "state", "progress", "started_on", "finished_on", "updated_at", "providers_consumed_on", "show_extra_information")
			VALUES ('seen-complete', 'user-a', 'show', 'completed', 100, '2024-01-01T10:00:00Z', '2024-01-02T00:00:00Z', ARRAY['2024-01-02T00:00:00Z'::timestamptz], '{Plex}', '{"season": 2, "episode": 1}'),
				('seen-progress', 'user-a', 'show', 'in_progress', 40, NULL, NULL, ARRAY['2024-02-01T08:00:00Z'::timestamptz], '{}', '{"season": 1, "episode": 5}'),
				('seen-present', 'user-a', 'show', 'completed', 100, NULL, '2024-01-05T00:00:00Z', ARRAY['2024-01-05T00:00:00Z'::timestamptz], '{}', '{"season": 1, "episode": 1}'),
				('seen-dropped', 'user-a', 'show', 'dropped', 0, NULL, NULL, ARRAY['2024-03-01T00:00:00Z'::timestamptz], '{}', '{"season": 2, "episode": 3}'),
				('seen-custom', 'user-a', 'custom-show', 'completed', 100, NULL, NULL, ARRAY['2024-03-02T00:00:00Z'::timestamptz], '{}', '{"season": 3, "episode": 1}'),
				('seen-b', 'user-b', 'show', 'completed', 100, NULL, NULL, ARRAY['2024-04-01T00:00:00Z'::timestamptz], '{}', '{"season": 2, "episode": 2}'),
				('seen-c', 'user-c', 'show', 'completed', 100, NULL, NULL, ARRAY['2024-04-02T00:00:00Z'::timestamptz], '{}', '{"season": 2, "episode": 2}'),
				('seen-disabled', 'user-d', 'show', 'completed', 100, NULL, NULL, ARRAY['2024-04-03T00:00:00Z'::timestamptz], '{}', '{"season": 2, "episode": 1}');
			INSERT INTO "review" ("id", "user_id", "metadata_id", "rating", "text", "posted_on", "show_extra_information")
			VALUES ('review-episode', 'user-a', 'show', 80, 'Synthetic review.', '2024-01-03T10:00:00Z', '{"season": 2, "episode": 1}'),
				('review-season', 'user-a', 'show', 60, NULL, '2024-01-04T10:00:00Z', '{"season": 3}'),
				('review-custom', 'user-a', 'custom-show', 40, NULL, '2024-01-04T11:00:00Z', '{"season": 3, "episode": 1}'),
				('review-present', 'user-a', 'show', 90, NULL, '2024-01-06T10:00:00Z', '{"season": 1, "episode": 1}');
			END $$`,
			[],
		);
	});

export const migrateLegacyHistory = (connection: SqlConnection.Connection) =>
	Effect.forEach(
		[buildReviewMigrationSql(mediaPluginId), buildSeenMigrationSql(mediaPluginId)],
		(statement) => connection.executeRaw(statement, []),
		{ discard: true },
	);

export const userAEvents = {
	reviewSeason: {
		eventSchemaSlug: "review",
		occurredAt: "2024-01-04T10:00:00.000Z",
		properties: { rating: 60, isSpoiler: false },
		episode: { seasonNumber: 3, type: "show-season" },
	},
	reviewEpisode: {
		eventSchemaSlug: "review",
		occurredAt: "2024-01-03T10:00:00.000Z",
		episode: { type: "show", seasonNumber: 2, episodeNumber: 1 },
		properties: { rating: 80, isSpoiler: false, text: "Synthetic review." },
	},
	seenProgress: {
		eventSchemaSlug: "progress",
		occurredAt: "2024-02-01T08:00:00.000Z",
		episode: { type: "show", seasonNumber: 1, episodeNumber: 5 },
		properties: { dateUnknown: true, progressPercent: 40, sourceRun: "seen:seen-progress" },
	},
	seenComplete: {
		eventSchemaSlug: "complete",
		occurredAt: "2024-01-02T00:00:00.000Z",
		episode: { type: "show", seasonNumber: 2, episodeNumber: 1 },
		properties: {
			consumedOn: ["Plex"],
			calendarDate: "2024-01-02",
			sourceRun: "seen:seen-complete",
			startedOn: "2024-01-01T10:00:00.000000Z",
		},
	},
} as const;
