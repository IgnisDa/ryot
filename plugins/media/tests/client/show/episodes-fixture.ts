import { Result } from "@ryot-app/client-sdk/effect";

import { showSeasonEpisodesRecipe, showSeasonsRecipe } from "../../../shared/show-recipes";
import { rowsResult } from "../query-result-fixture";

const showSeasonsFixtureRecipe = showSeasonsRecipe({ seasonLimit: 40, entityId: "show-1" });

const showSeasonEpisodesFixtureRecipe = showSeasonEpisodesRecipe({
	limit: 60,
	containerId: "season-1",
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
	episodeTotal: 1,
	watchedTotal: 1,
	seasonNumber: 1,
	upcomingTotal: 0,
	name: "Season 1",
	watchedMinutes: 66,
	watchedUnknownRuntime: 0,
	schemaSlug: "show-season",
	releaseDate: "2025-03-13",
	populationStatus: "ready",
	translationStatus: "none",
	description: "The complete limited series.",
	images: [{ type: "remote", purpose: "cover", url: "https://images.test/season-1.jpg" }],
};

export const decodeShowSeasonsResult = (input: {
	readonly show?: Record<string, unknown> | null;
	readonly seasons?: readonly Record<string, unknown>[];
}) => {
	const seasons = input.seasons ?? [showSeasonRow];
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
		showSeasonsFixtureRecipe.decode({
			data: { show: rowsResult(show, { limit: 1, hasMore: false, nextCursor: null }) },
		}),
	);
};

export const decodeShowSeasonEpisodesResult = (
	input: {
		readonly nextCursor?: string | null;
		readonly episodes?: readonly Record<string, unknown>[];
	} = {},
) =>
	Result.getOrThrow(
		showSeasonEpisodesFixtureRecipe.decode({
			data: {
				episodes: rowsResult(input.episodes ?? [showEpisodeRow], {
					limit: 60,
					nextCursor: input.nextCursor ?? null,
					hasMore: (input.nextCursor ?? null) !== null,
				}),
			},
		}),
	);
