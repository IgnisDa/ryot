import { Result, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import {
	and,
	ascending,
	castNumber,
	column,
	defineRecipe,
	entitySchemaPredicate,
	eq,
	join,
	jsonPath,
	literal,
	type PreparedRecipe,
	selectedField,
	selectedRows,
	table,
} from "@ryot-app/plugin-backend-sdk/ryotql";
import type { PluginIdentityReference } from "@ryot-app/plugin-kit/schema";

import {
	entitySchemaIs,
	type EpisodicKindConfig,
	type podcastEpisodicKindConfig,
	relationshipConnects,
	type showEpisodicKindConfig,
} from "../../shared/lifecycle-expressions";

const EpisodeParentResolutionSchema = Schema.Union([
	Schema.Struct({ parentEntityId: Schema.String, kind: Schema.Literal("podcast") }),
	Schema.Struct({
		seasonNumber: Schema.Finite,
		kind: Schema.Literal("show"),
		parentEntityId: Schema.String,
	}),
]);

export type EpisodeParentResolution = Schema.Schema.Type<typeof EpisodeParentResolutionSchema>;

export function resolveEpisodeParentRecipe(input: {
	readonly reference: PluginIdentityReference;
	readonly config: typeof showEpisodicKindConfig;
	readonly episodeEntityId: string;
}): PreparedRecipe<Extract<EpisodeParentResolution, { kind: "show" }> | null>;
export function resolveEpisodeParentRecipe(input: {
	readonly reference: PluginIdentityReference;
	readonly config: typeof podcastEpisodicKindConfig;
	readonly episodeEntityId: string;
}): PreparedRecipe<Extract<EpisodeParentResolution, { kind: "podcast" }> | null>;
export function resolveEpisodeParentRecipe(input: {
	readonly reference: PluginIdentityReference;
	readonly config: EpisodicKindConfig;
	readonly episodeEntityId: string;
}) {
	const episode = table("entity", "resolvedEpisode");
	const parent = table("entity", "resolvedParent");
	if (input.config.kind === "podcast") {
		const config = input.config;
		const relationship = table("relationship", "resolvedPodcastEpisode");
		return defineRecipe(() => ({
			map: ({ parents }) => {
				const match = parents.items.length === 1 ? parents.items[0] : undefined;
				return Result.succeed(match ? { ...match, kind: "podcast" as const } : null);
			},
			queries: {
				parents: selectedRows(parent, {
					limit: 2,
					orderBy: [ascending(column(parent, "id"))],
					selection: { parentEntityId: selectedField(column(parent, "id"), Schema.String) },
					joins: [
						join(
							"inner",
							relationship,
							eq(column(relationship, "sourceEntityId"), column(parent, "id")),
						),
						join(
							"inner",
							episode,
							eq(column(relationship, "targetEntityId"), column(episode, "id")),
						),
					],
					where: and(
						entitySchemaPredicate(parent, config.parentSchemaSlug, input.reference),
						entitySchemaIs(episode, config.episodeSchemaSlug),
						eq(column(episode, "id"), literal(input.episodeEntityId)),
						relationshipConnects(
							relationship,
							parent,
							episode,
							config.parentEpisodeRelationshipSlug,
						),
					),
				}),
			},
		}))();
	}

	const config = input.config;
	const season = table("entity", "resolvedSeason");
	const showSeason = table("relationship", "resolvedShowSeason");
	const seasonEpisode = table("relationship", "resolvedSeasonEpisode");
	return defineRecipe(() => ({
		map: ({ parents }) => {
			const match = parents.items.length === 1 ? parents.items[0] : undefined;
			return Result.succeed(match ? { ...match, kind: "show" as const } : null);
		},
		queries: {
			parents: selectedRows(parent, {
				limit: 2,
				orderBy: [ascending(column(parent, "id"))],
				selection: {
					parentEntityId: selectedField(column(parent, "id"), Schema.String),
					seasonNumber: selectedField(
						castNumber(jsonPath(column(season, "properties"), "seasonNumber")),
						Schema.Finite,
					),
				},
				joins: [
					join("inner", showSeason, eq(column(showSeason, "sourceEntityId"), column(parent, "id"))),
					join("inner", season, eq(column(showSeason, "targetEntityId"), column(season, "id"))),
					join(
						"inner",
						seasonEpisode,
						eq(column(seasonEpisode, "sourceEntityId"), column(season, "id")),
					),
					join(
						"inner",
						episode,
						eq(column(seasonEpisode, "targetEntityId"), column(episode, "id")),
					),
				],
				where: and(
					entitySchemaPredicate(parent, config.parentSchemaSlug, input.reference),
					entitySchemaIs(season, "show-season"),
					entitySchemaIs(episode, config.episodeSchemaSlug),
					eq(column(episode, "id"), literal(input.episodeEntityId)),
					relationshipConnects(showSeason, parent, season, config.parentSeasonRelationshipSlug),
					relationshipConnects(
						seasonEpisode,
						season,
						episode,
						config.seasonEpisodeRelationshipSlug,
					),
				),
			}),
		},
	}))();
}
