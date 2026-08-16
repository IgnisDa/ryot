import { showSeasonEpisodesRecipe, showSeasonsRecipe } from "@ryot/media-plugin/query-recipes";
import { rowsResult } from "@ryot/ryotql-recipes/test-utils";
import { Result } from "effect";

const showEpisodesFixtureRecipe = showSeasonsRecipe({ entityId: "show-1", seasonLimit: 40 });

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
	schemaSlug: "show-episode",
	publishDate: "2025-03-13",
	name: "Episode 1: The Arrest",
	description: "A thirteen-year-old is arrested at dawn.",
	images: [{ type: "remote", url: "https://images.test/episode-1.jpg", purpose: "still" }],
};

export const showSeasonRow = {
	id: "season-1",
	seasonNumber: 1,
	name: "Season 1",
	schemaSlug: "show-season",
	releaseDate: "2025-03-13",
	description: "The complete limited series.",
	images: [{ type: "remote", url: "https://images.test/season-1.jpg", purpose: "cover" }],
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
	pageInfo: { hasMore, limit },
});

const seasonRows = (input: SeasonEpisodeRows) => {
	const season = input.season === null ? null : (input.season ?? defaultSeasonEpisodes);
	if (season === null) {
		return [];
	}
	const { episodes = [], hasMore = false, ...row } = season;
	return [
		{
			...row,
			episodes: nestedRows(input.episodes ?? episodes, input.hasMore ?? hasMore, 60),
		},
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
						...input.show,
						seasons: { items: seasons, pageInfo: { hasMore: false, limit: 40 } },
					},
				];
	return Result.getOrThrow(
		showEpisodesFixtureRecipe.decode({
			data: { show: rowsResult(show, { hasMore: false, limit: 1, nextCursor: null }) },
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
