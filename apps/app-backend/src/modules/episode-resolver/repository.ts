import { EntityId, type UserId } from "@ryot/contract/schema/brands";
import { sql } from "drizzle-orm";
import { Effect } from "effect";

import { CurrentDb, dbEffect } from "#lib/infrastructure/db/service";

export class EpisodeResolverRepository extends Effect.Service<EpisodeResolverRepository>()(
	"EpisodeResolverRepository",
	{
		sync: () => {
			const findPodcastEpisodeCandidates = Effect.fn(
				"EpisodeResolverRepository.findPodcastEpisodeCandidates",
			)(function* (input: { userId: UserId; episodeNumber: number; podcastEntityId: EntityId }) {
				const db = yield* CurrentDb;
				const rows = yield* dbEffect(() =>
					db.execute<{ id: string }>(sql`
						SELECT DISTINCT episode.id
						FROM relationship podcast_episode_rel
						JOIN relationship_schema podcast_episode_rs
							ON podcast_episode_rs.id = podcast_episode_rel.relationship_schema_id
						JOIN entity episode
							ON episode.id = podcast_episode_rel.target_entity_id
						JOIN entity_schema episode_schema
							ON episode_schema.id = episode.entity_schema_id
						WHERE podcast_episode_rel.source_entity_id = ${input.podcastEntityId}
							AND podcast_episode_rs.slug = 'podcast-to-podcast-episode'
							AND podcast_episode_rs.user_id IS NULL
							AND episode_schema.slug = 'podcast-episode'
							AND (podcast_episode_rel.user_id = ${input.userId} OR podcast_episode_rel.user_id IS NULL)
							AND (episode.user_id = ${input.userId} OR episode.user_id IS NULL)
							AND jsonb_extract_path(episode.properties, 'episodeNumber') = to_jsonb(${input.episodeNumber}::int)
					`),
				);

				return rows.rows.map((row) => EntityId.make(row.id));
			});

			const findShowEpisodeCandidates = Effect.fn(
				"EpisodeResolverRepository.findShowEpisodeCandidates",
			)(function* (input: {
				userId: UserId;
				seasonNumber: number;
				episodeNumber: number;
				showEntityId: EntityId;
			}) {
				const db = yield* CurrentDb;
				const rows = yield* dbEffect(() =>
					db.execute<{ id: string }>(sql`
						SELECT DISTINCT episode.id
						FROM relationship show_season_rel
						JOIN relationship_schema show_season_rs
							ON show_season_rs.id = show_season_rel.relationship_schema_id
						JOIN entity season
							ON season.id = show_season_rel.target_entity_id
						JOIN entity_schema season_schema
							ON season_schema.id = season.entity_schema_id
						JOIN relationship season_episode_rel
							ON season_episode_rel.source_entity_id = season.id
						JOIN relationship_schema season_episode_rs
							ON season_episode_rs.id = season_episode_rel.relationship_schema_id
						JOIN entity episode
							ON episode.id = season_episode_rel.target_entity_id
						JOIN entity_schema episode_schema
							ON episode_schema.id = episode.entity_schema_id
						WHERE show_season_rel.source_entity_id = ${input.showEntityId}
							AND show_season_rs.slug = 'show-to-show-season'
							AND show_season_rs.user_id IS NULL
							AND season_episode_rs.slug = 'show-season-to-show-episode'
							AND season_episode_rs.user_id IS NULL
							AND season_schema.slug = 'show-season'
							AND episode_schema.slug = 'show-episode'
							AND (show_season_rel.user_id = ${input.userId} OR show_season_rel.user_id IS NULL)
							AND (season_episode_rel.user_id = ${input.userId} OR season_episode_rel.user_id IS NULL)
							AND (season.user_id = ${input.userId} OR season.user_id IS NULL)
							AND (episode.user_id = ${input.userId} OR episode.user_id IS NULL)
							AND jsonb_extract_path(season.properties, 'seasonNumber') = to_jsonb(${input.seasonNumber}::int)
							AND jsonb_extract_path(episode.properties, 'episodeNumber') = to_jsonb(${input.episodeNumber}::int)
					`),
				);

				return rows.rows.map((row) => EntityId.make(row.id));
			});

			return { findPodcastEpisodeCandidates, findShowEpisodeCandidates };
		},
	},
) {}
