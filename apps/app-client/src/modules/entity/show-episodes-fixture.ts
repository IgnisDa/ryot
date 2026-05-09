import { showDetailRecipe } from "@ryot/media-plugin/query-recipes";
import { rowsResult } from "@ryot/ryotql-recipes/test-utils";
import { Result } from "effect";

const showEpisodesFixtureRecipe = showDetailRecipe({
	seasonLimit: 40,
	episodeLimit: 60,
	entityId: "show-1",
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

type SeasonInput = Record<string, unknown> & {
	readonly hasMore?: boolean;
	readonly episodes?: readonly Record<string, unknown>[];
};

const defaultSeason: SeasonInput = { ...showSeasonRow, episodes: [showEpisodeRow] };

const nestedRows = (items: readonly unknown[], hasMore: boolean) => ({
	items,
	pageInfo: { hasMore, limit: 60 },
});

export const decodeShowEpisodesResult = (input: {
	readonly seasons?: readonly SeasonInput[];
	readonly show?: Record<string, unknown> | null;
}) => {
	const seasons = (input.seasons ?? [defaultSeason]).map(({ episodes, hasMore, ...season }) =>
		Object.assign(season, { episodes: nestedRows(episodes ?? [], hasMore === true) }),
	);
	const show =
		input.show === null
			? []
			: [
					{
						id: "show-1",
						schemaSlug: "show",
						name: "Adolescence",
						state: "in_progress",
						...input.show,
						seasons: { items: seasons, pageInfo: { hasMore: false, limit: 40 } },
					},
				];
	const decoded = showEpisodesFixtureRecipe.decode({
		data: { show: rowsResult(show, { hasMore: false, limit: 1, nextCursor: null }) },
	});
	if (Result.isFailure(decoded)) {
		throw new Error("Expected a decoded show detail result");
	}
	return decoded.success;
};
