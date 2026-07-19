import type { RyotQLDocument } from "@ryot/contract/modules/ryotql/language";
import { Effect } from "@ryot/sandbox-sdk/effect";
import {
	and,
	ascending,
	castNumber,
	column,
	document,
	eq,
	field,
	join,
	jsonPath,
	literal,
	rows,
	table,
} from "@ryot/sandbox-sdk/ryotql";

import { decodeEntityIds } from "../shared/ryotql";
import type { ResolveEpisodesRef } from "./schemas";

const buildShowEpisodeDocument = (ref: Extract<ResolveEpisodesRef, { kind: "show" }>) => {
	const episode = table("entity", "episode");
	const season = table("entity", "season");
	const show = table("entity", "show");
	const seasonEpisode = table("relationship", "seasonEpisode");
	const showSeason = table("relationship", "showSeason");
	return document({
		episodes: rows(episode, {
			limit: 2,
			orderBy: [ascending(column(episode, "id"))],
			fields: [field("entityId", column(episode, "id"))],
			joins: [
				join(
					"inner",
					seasonEpisode,
					eq(column(seasonEpisode, "targetEntityId"), column(episode, "id")),
				),
				join("inner", season, eq(column(seasonEpisode, "sourceEntityId"), column(season, "id"))),
				join("inner", showSeason, eq(column(showSeason, "targetEntityId"), column(season, "id"))),
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
				eq(column(seasonEpisode, "relationshipSchemaSlug"), literal("show-season-to-show-episode")),
				eq(column(showSeason, "relationshipSchemaSlug"), literal("show-to-show-season")),
			),
		}),
	});
};

const buildPodcastEpisodeDocument = (ref: Extract<ResolveEpisodesRef, { kind: "podcast" }>) => {
	const episode = table("entity", "episode");
	const podcast = table("entity", "podcast");
	const relationship = table("relationship", "podcastEpisode");
	return document({
		episodes: rows(episode, {
			limit: 2,
			orderBy: [ascending(column(episode, "id"))],
			fields: [field("entityId", column(episode, "id"))],
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
	});
};

const resolveDocument = (ref: ResolveEpisodesRef): RyotQLDocument =>
	ref.kind === "show" ? buildShowEpisodeDocument(ref) : buildPodcastEpisodeDocument(ref);

export const resolveEpisodes = (
	refs: ReadonlyArray<ResolveEpisodesRef>,
	executeRyotql: (document: RyotQLDocument) => Effect.Effect<unknown, unknown>,
) =>
	Effect.forEach(refs, (ref) =>
		executeRyotql(resolveDocument(ref)).pipe(
			Effect.map((response) => {
				const entityIds = decodeEntityIds(response, "episodes");
				return {
					index: ref.index,
					entityId: entityIds.length === 1 ? (entityIds[0] ?? null) : null,
				};
			}),
		),
	);
