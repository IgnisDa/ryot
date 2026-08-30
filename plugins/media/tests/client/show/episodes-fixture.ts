import { Result } from "@ryot-app/client-sdk/effect";

import { showSeasonEpisodesRecipe, showSeasonsRecipe } from "../../../shared/show-recipes";
import { rowsResult } from "./query-result-fixture";

const showEpisodesFixtureRecipe = showSeasonsRecipe({ seasonLimit: 40, entityId: "show-1" });

const showSeasonEpisodesFixtureRecipe = showSeasonEpisodesRecipe({
	episodeLimit: 60,
	seasonId: "season-1",
});

export const showEpisodeRow = {
	runtime: 66,
	id: "episode-1",
	seasonNumber: 1,
	episodeNumber: 1,
	state: "complete",
	publishDate: "2025-03-13",
	populationStatus: "ready",
	translationStatus: "none",
	schemaSlug: "show-episode",
	name: "Episode 1: The Arrest",
	description: "A thirteen-year-old is arrested at dawn.",
	images: [{ type: "remote", purpose: "still", url: "https://images.test/episode-1.jpg" }],
};

export const showSeasonRow = {
	id: "season-1",
	seasonNumber: 1,
	name: "Season 1",
	schemaSlug: "show-season",
	releaseDate: "2025-03-13",
	populationStatus: "ready",
	translationStatus: "none",
	description: "The complete limited series.",
	images: [{ type: "remote", purpose: "cover", url: "https://images.test/season-1.jpg" }],
};

type SeasonInput = Record<string, unknown>;

type SeasonEpisodesInput = Record<string, unknown> & {
	readonly hasMore?: boolean;
	readonly episodes?: readonly Record<string, unknown>[];
};

type SeasonEpisodeRows = {
	readonly hasMore?: boolean;
	readonly season?: SeasonEpisodesInput | null;
	readonly episodes?: readonly Record<string, unknown>[];
};

const defaultSeason: SeasonInput = { ...showSeasonRow };

const defaultSeasonEpisodes: SeasonEpisodesInput = { ...showSeasonRow, episodes: [showEpisodeRow] };

const nestedRows = (items: readonly unknown[], hasMore: boolean, limit: number) => ({
	items,
	pageInfo: { limit, hasMore },
});

const seasonRows = (input: SeasonEpisodeRows) => {
	const season = input.season === null ? null : (input.season ?? defaultSeasonEpisodes);
	if (season === null) {
		return [];
	}
	const { episodes = [], hasMore = false, ...row } = season;
	return [
		{ ...row, episodes: nestedRows(input.episodes ?? episodes, input.hasMore ?? hasMore, 60) },
	];
};

export const decodeShowEpisodesResult = (input: {
	readonly seasons?: readonly SeasonInput[];
	readonly show?: Record<string, unknown> | null;
}) => {
	const seasons = input.seasons ?? [defaultSeason];
	const show =
		input.show === null
			? []
			: [
					{
						id: "show-1",
						schemaSlug: "show",
						name: "Adolescence",
						populationStatus: "ready",
						translationStatus: "none",
						...input.show,
						seasons: { items: seasons, pageInfo: { limit: 40, hasMore: false } },
					},
				];
	return Result.getOrThrow(
		showEpisodesFixtureRecipe.decode({
			data: { show: rowsResult(show, { limit: 1, hasMore: false, nextCursor: null }) },
		}),
	);
};

export const decodeShowSeasonEpisodesResult = (input: SeasonEpisodeRows) => {
	return Result.getOrThrow(
		showSeasonEpisodesFixtureRecipe.decode({
			data: {
				season: rowsResult(seasonRows(input), { limit: 1, hasMore: false, nextCursor: null }),
			},
		}),
	);
};
