import { Effect, Result, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import {
	and,
	ascending,
	castNumber,
	column,
	defineRecipe,
	entitySchemaPredicate,
	eq,
	executeRyotqlRecipe,
	join,
	jsonPath,
	literal,
	type Recipe,
	relationshipSchemaPredicate,
	type RyotQLDocument,
	selectedField,
	selectedRows,
	table,
} from "@ryot-app/plugin-backend-sdk/ryotql";
import type { SandboxHostError } from "@ryot-app/plugin-backend-sdk/wire";
import type { PluginIdentityReference } from "@ryot-app/plugin-kit/schema";

import type { ResolveEpisodesRef } from "../contracts/operations";

export const resolveEpisodeRecipe = defineRecipe(
	(reference: PluginIdentityReference, ref: ResolveEpisodesRef) => {
		if (ref.kind === "show-season") {
			const show = table("entity", "show");
			const season = table("entity", "season");
			const showSeason = table("relationship", "showSeason");
			return {
				map: ({ episodes }) =>
					Result.succeed(
						episodes.items.length === 1 ? (episodes.items[0]?.entityId ?? null) : null,
					),
				queries: {
					episodes: selectedRows(season, {
						limit: 2,
						orderBy: [ascending(column(season, "id"))],
						selection: { entityId: selectedField(column(season, "id"), Schema.String) },
						joins: [
							join(
								"inner",
								showSeason,
								eq(column(showSeason, "targetEntityId"), column(season, "id")),
							),
							join("inner", show, eq(column(showSeason, "sourceEntityId"), column(show, "id"))),
						],
						where: and(
							entitySchemaPredicate(show, "show", reference),
							entitySchemaPredicate(season, "show-season", reference),
							relationshipSchemaPredicate(showSeason, "show-to-show-season", reference),
							eq(
								castNumber(jsonPath(column(season, "properties"), "seasonNumber")),
								literal(ref.seasonNumber),
							),
							eq(column(show, "id"), literal(ref.showEntityId)),
						),
					}),
				},
			};
		}
		const episode = table("entity", "episode");
		const selection = { entityId: selectedField(column(episode, "id"), Schema.String) };
		if (ref.kind === "show") {
			const season = table("entity", "season");
			const show = table("entity", "show");
			const seasonEpisode = table("relationship", "seasonEpisode");
			const showSeason = table("relationship", "showSeason");
			return {
				map: ({ episodes }) =>
					Result.succeed(
						episodes.items.length === 1 ? (episodes.items[0]?.entityId ?? null) : null,
					),
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
							entitySchemaPredicate(show, "show", reference),
							entitySchemaPredicate(season, "show-season", reference),
							entitySchemaPredicate(episode, "show-episode", reference),
							relationshipSchemaPredicate(showSeason, "show-to-show-season", reference),
							relationshipSchemaPredicate(seasonEpisode, "show-season-to-show-episode", reference),
							eq(
								castNumber(jsonPath(column(episode, "properties"), "episodeNumber")),
								literal(ref.episodeNumber),
							),
							eq(
								castNumber(jsonPath(column(season, "properties"), "seasonNumber")),
								literal(ref.seasonNumber),
							),
							eq(column(show, "id"), literal(ref.showEntityId)),
						),
					}),
				},
			};
		}

		const podcast = table("entity", "podcast");
		const relationship = table("relationship", "podcastEpisode");
		return {
			map: ({ episodes }) =>
				Result.succeed(episodes.items.length === 1 ? (episodes.items[0]?.entityId ?? null) : null),
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
						join(
							"inner",
							podcast,
							eq(column(relationship, "sourceEntityId"), column(podcast, "id")),
						),
					],
					where: and(
						entitySchemaPredicate(podcast, "podcast", reference),
						entitySchemaPredicate(episode, "podcast-episode", reference),
						relationshipSchemaPredicate(relationship, "podcast-to-podcast-episode", reference),
						ref.kind === "podcast-title"
							? eq(column(episode, "name"), literal(ref.episodeTitle))
							: eq(
									castNumber(jsonPath(column(episode, "properties"), "episodeNumber")),
									literal(ref.episodeNumber),
								),
						eq(column(podcast, "id"), literal(ref.podcastEntityId)),
					),
				}),
			},
		};
	},
);

export type ResolveEpisodeResult = Recipe.Success<typeof resolveEpisodeRecipe>;

export const resolveEpisodes = (
	refs: ReadonlyArray<ResolveEpisodesRef>,
	executeRyotql: (document: RyotQLDocument) => Effect.Effect<unknown, SandboxHostError>,
) =>
	Effect.forEach(refs, (ref) =>
		executeRyotqlRecipe(executeRyotql, resolveEpisodeRecipe({ kind: "self" }, ref)).pipe(
			Effect.map((entityId) => ({ entityId, index: ref.index })),
		),
	);
