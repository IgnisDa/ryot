import type { RyotQueryResult } from "@ryot-app/client-sdk/react";

import type { ShowSeasonEpisodesResult, ShowSeasonsResult } from "../../shared/show-recipes";
import { optionalText } from "../media/activity-timeline";
import { formatDateOnlyLabel } from "../media/date";
import { collectManagedAssetLocators, preferredMediaImageAsset } from "../media/image";
import { classifyRyotQueryResult, type MappedRyotQueryState } from "../media/query-state";

type ShowSeasons = NonNullable<ShowSeasonsResult>;
type ShowSeasonEpisodes = NonNullable<ShowSeasonEpisodesResult>;

export type ShowSeason = ShowSeasons["seasons"]["items"][number];

export type ShowEpisode = ShowSeasonEpisodes["episodes"]["items"][number];

export type ShowSeasonList = readonly [ShowSeason, ...ShowSeason[]];

export type ShowEpisodesState = MappedRyotQueryState<
	{ readonly status: "empty" } | { readonly status: "ready"; readonly seasons: ShowSeasonList }
>;

export type ShowSeasonEpisodesState = MappedRyotQueryState<
	{ readonly status: "empty" } | { readonly status: "ready"; readonly season: ShowSeasonEpisodes }
>;

type ShowEpisodesFailure = Pick<
	Extract<ShowEpisodesState, { status: "transport-error" | "malformed" }>,
	"status"
>;

type ShowSeasonEpisodesFailure = Pick<
	Extract<ShowSeasonEpisodesState, { status: "transport-error" | "malformed" }>,
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

export const mapShowEpisodes = (result: RyotQueryResult<ShowSeasonsResult>): ShowEpisodesState => {
	const state = classifyRyotQueryResult(result);
	if (state.status !== "ready") {
		return state;
	}
	const [first, ...rest] = orderShowSeasons(state.value?.seasons.items ?? []);
	return first === undefined ? { status: "empty" } : { status: "ready", seasons: [first, ...rest] };
};

export const mapShowSeasonEpisodes = (
	result: RyotQueryResult<ShowSeasonEpisodesResult>,
): ShowSeasonEpisodesState => {
	const state = classifyRyotQueryResult(result);
	if (state.status !== "ready") {
		return state;
	}
	return state.value === null ? { status: "empty" } : { status: "ready", season: state.value };
};

export const showEpisodesError = (state: ShowEpisodesFailure) => ({
	title: "Unable to load episodes",
	detail:
		state.status === "transport-error"
			? "The seasons could not be loaded. Check your connection and try again."
			: "These seasons came back in a form that could not be displayed. Try again later.",
});

export const showSeasonEpisodesError = (state: ShowSeasonEpisodesFailure) => ({
	title: "Unable to load this season",
	detail:
		state.status === "transport-error"
			? "This season's episodes could not be loaded. Check your connection and try again."
			: "This season's episodes came back in a form that could not be displayed. Try again later.",
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

const showSeasonCompletion = (season: ShowSeasonEpisodes) => ({
	total: season.episodes.items.length,
	hasMore: season.episodes.pageInfo.hasMore,
	completed: season.episodes.items.filter((episode) => episode.state === "complete").length,
});

export const showSeasonCompletionPercent = (season: ShowSeasonEpisodes) => {
	const { total, hasMore, completed } = showSeasonCompletion(season);
	return hasMore || total === 0 ? undefined : Math.round((completed / total) * 100);
};

export const showSeasonEpisodeCountLabel = (season: ShowSeasonEpisodes) => {
	const { total, hasMore } = showSeasonCompletion(season);
	if (total === 0) {
		return undefined;
	}
	return hasMore ? `${total}+ episodes` : `${total} ${total === 1 ? "episode" : "episodes"}`;
};

export const showSeasonCompletedLabel = (season: ShowSeasonEpisodes) => {
	const { completed } = showSeasonCompletion(season);
	return completed === 0 ? undefined : `${completed} watched`;
};

export const showNextUpEpisode = (episodes: readonly ShowEpisode[]) => {
	const inProgress = episodes.find((episode) => episode.state === "in_progress");
	if (inProgress !== undefined) {
		return inProgress;
	}
	const lastCompleted = episodes.reduce(
		(last, episode, index) => (episode.state === "complete" ? index : last),
		-1,
	);
	return lastCompleted === -1
		? undefined
		: episodes.slice(lastCompleted + 1).find((episode) => episode.state === "untracked");
};

const mediaDateLabel = (value: string | null) => {
	const text = optionalText(value);
	if (text === undefined) {
		return undefined;
	}
	return formatDateOnlyLabel(text);
};

export const showSeasonDescription = (season: ShowSeason) => optionalText(season.description);

export const showEpisodeSynopsis = (episode: ShowEpisode) => optionalText(episode.description);

export const showSeasonReleaseLabel = (season: ShowSeason) => mediaDateLabel(season.releaseDate);

export const showEpisodeAirDateLabel = (episode: ShowEpisode) =>
	mediaDateLabel(episode.publishDate);

export const showEpisodeRuntimeLabel = (episode: ShowEpisode) =>
	episode.runtime === null ? undefined : `${episode.runtime} min`;

export const showEpisodeNumberLabel = (episode: ShowEpisode) => `E${episode.episodeNumber}`;

export const showEpisodeOriginLabel = (episode: {
	readonly seasonNumber: number;
	readonly episodeNumber: number;
}) =>
	episode.seasonNumber === SPECIALS_SEASON_NUMBER
		? `${SPECIALS_LABEL} • E${episode.episodeNumber}`
		: `S${episode.seasonNumber} • E${episode.episodeNumber}`;

const EPISODE_STATE_LABELS: Record<ShowEpisode["state"], string | undefined> = {
	complete: "Watched",
	untracked: undefined,
	in_progress: "In progress",
};

export const showEpisodeStateLabel = (state: ShowEpisode["state"]) => EPISODE_STATE_LABELS[state];

export const showSeasonAsset = (season: ShowSeason) =>
	preferredMediaImageAsset(season.images, "cover");

export const showEpisodeAsset = (episode: ShowEpisode) =>
	preferredMediaImageAsset(episode.images, "still");

export const showEpisodesManagedAssets = (
	seasons: ShowSeasonList,
	seasonEpisodes: ShowSeasonEpisodesState,
) =>
	collectManagedAssetLocators([
		...seasons.map(showSeasonAsset),
		...(seasonEpisodes.status === "ready"
			? seasonEpisodes.season.episodes.items.map(showEpisodeAsset)
			: []),
	]);
