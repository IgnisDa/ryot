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
	type ExecutionRequest,
	exists,
	join,
	jsonPath,
	parameters,
	type Recipe,
	relationshipSchemaPredicate,
	selectedField,
	selectedRows,
	table,
} from "@ryot-app/plugin-backend-sdk/ryotql";
import type { SandboxHostError } from "@ryot-app/plugin-backend-sdk/wire";
import type { PluginIdentityReference } from "@ryot-app/plugin-kit/schema";

import type { ResolveEpisodesRef } from "../../shared/integration-operations";

const input = parameters({
	fields: {
		episodeNumber: {
			type: "integer",
			defaultValue: 0,
			label: "Episode",
			description: "Episode number",
		},
		seasonNumber: {
			type: "integer",
			label: "Season",
			defaultValue: 0,
			description: "Show season number",
		},
		episodeTitle: {
			type: "string",
			defaultValue: "",
			label: "Episode title",
			description: "Exact podcast episode title",
		},
		parentEntityId: {
			type: "string",
			label: "Parent",
			validation: { required: true },
			description: "Show or podcast that contains the requested item",
		},
		kind: {
			type: "enum",
			label: "Reference",
			validation: { required: true },
			description: "Kind of season or episode reference",
			choices: {
				kind: "static",
				values: [
					{ value: "show-season" },
					{ value: "show" },
					{ value: "podcast" },
					{ value: "podcast-title" },
				],
			},
		},
	},
});
export const resolveEpisodeRecipe = (reference: PluginIdentityReference) => {
	const subject = table("entity", "episode");
	const show = table("entity", "show"),
		season = table("entity", "season"),
		podcast = table("entity", "podcast");
	const showSeason = table("relationship", "showSeason"),
		seasonEpisode = table("relationship", "seasonEpisode"),
		podcastEpisode = table("relationship", "podcastEpisode");
	const number = (entity: typeof subject, key: string) =>
		castNumber(jsonPath(column(entity, "properties"), key));
	const seasonMatch = and(
		entitySchemaPredicate(subject, "show-season", reference),
		eq(number(subject, "seasonNumber"), input.value("seasonNumber")),
		exists(show, {
			joins: [
				join("inner", showSeason, eq(column(showSeason, "sourceEntityId"), column(show, "id"))),
			],
			where: and(
				entitySchemaPredicate(show, "show", reference),
				relationshipSchemaPredicate(showSeason, "show-to-show-season", reference),
				eq(column(showSeason, "targetEntityId"), column(subject, "id")),
				eq(column(show, "id"), input.value("parentEntityId")),
			),
		}),
	);
	const showMatch = and(
		entitySchemaPredicate(subject, "show-episode", reference),
		eq(number(subject, "episodeNumber"), input.value("episodeNumber")),
		exists(season, {
			joins: [
				join(
					"inner",
					seasonEpisode,
					eq(column(seasonEpisode, "sourceEntityId"), column(season, "id")),
				),
				join("inner", showSeason, eq(column(showSeason, "targetEntityId"), column(season, "id"))),
				join("inner", show, eq(column(showSeason, "sourceEntityId"), column(show, "id"))),
			],
			where: and(
				entitySchemaPredicate(show, "show", reference),
				entitySchemaPredicate(season, "show-season", reference),
				relationshipSchemaPredicate(showSeason, "show-to-show-season", reference),
				relationshipSchemaPredicate(seasonEpisode, "show-season-to-show-episode", reference),
				eq(column(seasonEpisode, "targetEntityId"), column(subject, "id")),
				eq(number(season, "seasonNumber"), input.value("seasonNumber")),
				eq(column(show, "id"), input.value("parentEntityId")),
			),
		}),
	);
	const podcastMatch = and(
		entitySchemaPredicate(subject, "podcast-episode", reference),
		exists(podcast, {
			joins: [
				join(
					"inner",
					podcastEpisode,
					eq(column(podcastEpisode, "sourceEntityId"), column(podcast, "id")),
				),
			],
			where: and(
				entitySchemaPredicate(podcast, "podcast", reference),
				relationshipSchemaPredicate(podcastEpisode, "podcast-to-podcast-episode", reference),
				eq(column(podcastEpisode, "targetEntityId"), column(subject, "id")),
				eq(column(podcast, "id"), input.value("parentEntityId")),
			),
		}),
	);
	return defineRecipe({
		parameters: input.schema,
		map: ({ episodes }) =>
			Result.succeed(episodes.items.length === 1 ? (episodes.items[0]?.entityId ?? null) : null),
		queries: {
			episodes: selectedRows(subject, {
				limit: 2,
				orderBy: [ascending(column(subject, "id"))],
				selection: { entityId: selectedField(column(subject, "id"), Schema.String) },
				where: input.choice("kind", {
					show: showMatch,
					"show-season": seasonMatch,
					"podcast-title": and(
						podcastMatch,
						eq(column(subject, "name"), input.value("episodeTitle")),
					),
					podcast: and(
						podcastMatch,
						eq(number(subject, "episodeNumber"), input.value("episodeNumber")),
					),
				}),
			}),
		},
	});
};
export type ResolveEpisodeResult = Recipe.Success<ReturnType<typeof resolveEpisodeRecipe>>;

export const resolveEpisodes = (
	refs: ReadonlyArray<ResolveEpisodesRef>,
	executeRyotql: (request: ExecutionRequest) => Effect.Effect<unknown, SandboxHostError>,
) =>
	Effect.forEach(refs, (ref) =>
		executeRyotqlRecipe(executeRyotql, resolveEpisodeRecipe({ kind: "self" }), {
			kind: ref.kind,
			parentEntityId:
				ref.kind === "show" || ref.kind === "show-season" ? ref.showEntityId : ref.podcastEntityId,
			...(ref.kind === "show" || ref.kind === "show-season"
				? { seasonNumber: ref.seasonNumber }
				: {}),
			...(ref.kind === "show" || ref.kind === "podcast"
				? { episodeNumber: ref.episodeNumber }
				: {}),
			...(ref.kind === "podcast-title" ? { episodeTitle: ref.episodeTitle } : {}),
		}).pipe(Effect.map((entityId) => ({ entityId, index: ref.index }))),
	);
