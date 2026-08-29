import type { RyotQueryResult } from "@ryot-app/client-sdk/react";
import type { Recipe } from "@ryot-app/client-sdk/ryotql";

import type { showSeasonEpisodesRecipe, showSeasonsRecipe } from "../../shared/show-recipes";
import { optionalText } from "../media/activity-timeline";
import { mediaDateLabel } from "../media/episodes-state";
import { collectManagedAssetLocators, preferredMediaImageAsset } from "../media/image";
import { classifyRyotQueryResult, type MappedRyotQueryState } from "../media/query-state";

export type ShowSeasonsResult = Recipe.Success<typeof showSeasonsRecipe>;

type ShowSeasons = NonNullable<ShowSeasonsResult>;

export type ShowSeason = ShowSeasons["seasons"]["items"][number];

export type ShowEpisode = Recipe.Success<typeof showSeasonEpisodesRecipe>["items"][number];

export type ShowSeasonList = readonly [ShowSeason, ...ShowSeason[]];

export type ShowSeasonsState = MappedRyotQueryState<
	{ readonly status: "empty" } | { readonly status: "ready"; readonly seasons: ShowSeasonList }
>;

type ShowSeasonsFailure = Pick<
	Extract<ShowSeasonsState, { status: "transport-error" | "malformed" }>,
	"status"
>;

const SPECIALS_LABEL = "Specials";

const SPECIALS_SEASON_NUMBER = 0;

type SeasonNumbered = { readonly seasonNumber: number };

export const isSpecialsSeason = (season: SeasonNumbered) =>
	season.seasonNumber === SPECIALS_SEASON_NUMBER;

export const seasonOrder = (season: SeasonNumbered) =>
	isSpecialsSeason(season) ? Number.MAX_SAFE_INTEGER : season.seasonNumber;

export const showSeasonOriginLabel = (season: SeasonNumbered) =>
	isSpecialsSeason(season) ? SPECIALS_LABEL : `Season ${season.seasonNumber}`;

const orderShowSeasons = (seasons: readonly ShowSeason[]) =>
	[...seasons].sort((left, right) => seasonOrder(left) - seasonOrder(right));

export const mapShowSeasons = (result: RyotQueryResult<ShowSeasonsResult>): ShowSeasonsState => {
	const state = classifyRyotQueryResult(result);
	if (state.status !== "ready") {
		return state;
	}
	const [first, ...rest] = orderShowSeasons(state.value?.seasons.items ?? []);
	return first === undefined ? { status: "empty" } : { status: "ready", seasons: [first, ...rest] };
};

export const showSeasonsError = (state: ShowSeasonsFailure) => ({
	title: "Unable to load episodes",
	detail:
		state.status === "transport-error"
			? "The seasons could not be loaded. Check your connection and try again."
			: "These seasons came back in a form that could not be displayed. Try again later.",
});

export const selectedShowSeason = (seasons: ShowSeasonList, seasonId: string | null) =>
	seasons.find((season) => season.id === seasonId) ??
	seasons.find((season) => !isSpecialsSeason(season)) ??
	seasons[0];

export const showSeasonLabel = (season: ShowSeason) => {
	if (isSpecialsSeason(season)) {
		return SPECIALS_LABEL;
	}
	return season.name.trim() === "" ? showSeasonOriginLabel(season) : season.name;
};

export const showSeasonCompletionPercent = (season: ShowSeason) =>
	season.episodeTotal === 0
		? undefined
		: Math.min(Math.round((season.watchedTotal / season.episodeTotal) * 100), 100);

export const showSeasonEpisodeCountLabel = (season: ShowSeason) =>
	season.episodeTotal === 0
		? undefined
		: `${season.episodeTotal} ${season.episodeTotal === 1 ? "episode" : "episodes"}`;

export const showSeasonCompletedLabel = (season: ShowSeason) =>
	season.watchedTotal === 0 ? undefined : `${season.watchedTotal} watched`;

export const showSeasonDescription = (season: ShowSeason) => optionalText(season.description);

export const showSeasonReleaseLabel = (season: ShowSeason) => mediaDateLabel(season.releaseDate);

export const showEpisodeOriginLabel = (episode: {
	readonly seasonNumber: number;
	readonly episodeNumber: number;
}) =>
	isSpecialsSeason(episode)
		? `${SPECIALS_LABEL} • E${episode.episodeNumber}`
		: `S${episode.seasonNumber} • E${episode.episodeNumber}`;

export const showSeasonAsset = (season: ShowSeason) =>
	preferredMediaImageAsset(season.images, "cover");

export const showSeasonsManagedAssets = (seasons: ShowSeasonList) =>
	collectManagedAssetLocators(seasons.map(showSeasonAsset));
