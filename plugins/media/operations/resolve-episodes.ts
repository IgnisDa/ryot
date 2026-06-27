import { Effect, Result, Schema } from "@ryot/sandbox-sdk/effect";
import {
	and,
	ascending,
	castNumber,
	column,
	defineRecipe,
	eq,
	join,
	jsonPath,
	literal,
	selectedField,
	selectedRows,
	executeRyotqlRecipe,
	table,
	type Recipe,
	type RyotQLDocument,
} from "@ryot/sandbox-sdk/ryotql";

import type { ResolveEpisodesRef } from "./schemas";

export const resolveEpisodeRecipe = defineRecipe((ref: ResolveEpisodesRef) => {
	const episode = table("entity", "episode");
	const selection = { entityId: selectedField(column(episode, "id"), Schema.String) };
	if (ref.kind === "show") {
		const season = table("entity", "season");
		const show = table("entity", "show");
		const seasonEpisode = table("relationship", "seasonEpisode");
		const showSeason = table("relationship", "showSeason");
		return {
			queries: {
				episodes: selectedRows(episode, {
					limit: 2,
					selection,
					orderBy: [ascending(column(episode, "id"))],
					joins: [
						join(
							"inner",
							seasonEpisode,
							eq(column(seasonEpisode, "targetEntityId"), column(episode, "id")),
						),
						join(
							"inner",
							season,
							eq(column(seasonEpisode, "sourceEntityId"), column(season, "id")),
						),
						join(
							"inner",
							showSeason,
							eq(column(showSeason, "targetEntityId"), column(season, "id")),
						),
						join("inner", show, eq(column(showSeason, "sourceEntityId"), column(show, "id"))),
					],
					where: and(
						eq(column(episode, "entitySchemaSlug"), literal("show-episode")),
						eq(
							castNumber(jsonPath(column(episode, "properties"), "episodeNumber")),
							literal(ref.episodeNumber),
						),
						eq(column(season, "entitySchemaSlug"), literal("show-season")),
						eq(
							castNumber(jsonPath(column(season, "properties"), "seasonNumber")),
							literal(ref.seasonNumber),
						),
						eq(column(show, "entitySchemaSlug"), literal("show")),
						eq(column(show, "id"), literal(ref.showEntityId)),
						eq(
							column(seasonEpisode, "relationshipSchemaSlug"),
							literal("show-season-to-show-episode"),
						),
						eq(column(showSeason, "relationshipSchemaSlug"), literal("show-to-show-season")),
					),
				}),
			},
			map: ({ episodes }) =>
				Result.succeed(episodes.items.length === 1 ? (episodes.items[0]?.entityId ?? null) : null),
		};
	}

	const podcast = table("entity", "podcast");
	const relationship = table("relationship", "podcastEpisode");
	return {
		queries: {
			episodes: selectedRows(episode, {
				limit: 2,
				selection,
				orderBy: [ascending(column(episode, "id"))],
				joins: [
					join(
						"inner",
						relationship,
						eq(column(relationship, "targetEntityId"), column(episode, "id")),
					),
					join("inner", podcast, eq(column(relationship, "sourceEntityId"), column(podcast, "id"))),
				],
				where: and(
					eq(column(episode, "entitySchemaSlug"), literal("podcast-episode")),
					eq(
						castNumber(jsonPath(column(episode, "properties"), "episodeNumber")),
						literal(ref.episodeNumber),
					),
					eq(column(podcast, "entitySchemaSlug"), literal("podcast")),
					eq(column(podcast, "id"), literal(ref.podcastEntityId)),
					eq(column(relationship, "relationshipSchemaSlug"), literal("podcast-to-podcast-episode")),
				),
			}),
		},
		map: ({ episodes }) =>
			Result.succeed(episodes.items.length === 1 ? (episodes.items[0]?.entityId ?? null) : null),
	};
});

export type ResolveEpisodeResult = Recipe.Success<typeof resolveEpisodeRecipe>;

export const resolveEpisodes = (
	refs: ReadonlyArray<ResolveEpisodesRef>,
	executeRyotql: (document: RyotQLDocument) => Effect.Effect<unknown, unknown>,
) =>
	Effect.forEach(refs, (ref) =>
		executeRyotqlRecipe(executeRyotql, resolveEpisodeRecipe(ref)).pipe(
			Effect.map((entityId) => ({ entityId, index: ref.index })),
		),
	);
