import type { ShowDetailResult } from "@ryot/media-plugin/query-recipes";
import { dayjs } from "@ryot/ts-utils/dayjs";
import { Match } from "effect";
import type { AsyncResult } from "effect/unstable/reactivity";

import { classifyRyotQLResult } from "@/api/ryotql";
import { canonicalManagedAssets } from "@/modules/ui/managed-assets";

import { preferredMediaImageAsset } from "./media-image";

type ShowDetail = NonNullable<ShowDetailResult>;

export type ShowSeason = ShowDetail["seasons"]["items"][number];

export type ShowEpisode = ShowSeason["episodes"]["items"][number];

export type ShowSeasonList = readonly [ShowSeason, ...ShowSeason[]];

export type ShowEpisodesState =
	| { readonly status: "empty" }
	| { readonly status: "loading" }
	| { readonly status: "malformed"; readonly cause: unknown }
	| { readonly status: "ready"; readonly seasons: ShowSeasonList }
	| { readonly status: "transport-error"; readonly cause: unknown };

const SPECIALS_LABEL = "Specials";

const SPECIALS_SEASON_NUMBER = 0;

export const isSpecialsSeason = (season: ShowSeason) =>
	season.seasonNumber === SPECIALS_SEASON_NUMBER;

const seasonOrder = (season: ShowSeason) =>
	isSpecialsSeason(season) ? Number.MAX_SAFE_INTEGER : season.seasonNumber;

const orderShowSeasons = (seasons: readonly ShowSeason[]) =>
	[...seasons].sort((left, right) => seasonOrder(left) - seasonOrder(right));

export const mapShowEpisodes = (
	result: AsyncResult.AsyncResult<ShowDetailResult, unknown>,
): ShowEpisodesState => {
	const state = classifyRyotQLResult(result);
	if (state.status !== "ready") {
		return state;
	}
	const [first, ...rest] = orderShowSeasons(state.value?.seasons.items ?? []);
	return first === undefined ? { status: "empty" } : { status: "ready", seasons: [first, ...rest] };
};

export const showEpisodesError = (state: { readonly status: "transport-error" | "malformed" }) => ({
	title: "Unable to load episodes",
	detail:
		state.status === "transport-error"
			? "The seasons and episodes could not be loaded. Check your connection and try again."
			: "These episodes came back in a form that could not be displayed. Try again later.",
});

export const selectedShowSeason = (seasons: ShowSeasonList, seasonId: string | null) =>
	seasons.find((season) => season.id === seasonId) ??
	seasons.find((season) => !isSpecialsSeason(season)) ??
	seasons[0];

export const showSeasonLabel = (season: ShowSeason) => {
	if (isSpecialsSeason(season)) {
		return SPECIALS_LABEL;
	}
	return season.name.trim() === "" ? `Season ${season.seasonNumber}` : season.name;
};

const showSeasonCompletion = (season: ShowSeason) => ({
	total: season.episodes.items.length,
	hasMore: season.episodes.pageInfo.hasMore,
	completed: season.episodes.items.filter((episode) => episode.state === "complete").length,
});

export const showSeasonCompletionPercent = (season: ShowSeason) => {
	const { total, completed, hasMore } = showSeasonCompletion(season);
	return hasMore || total === 0 ? undefined : Math.round((completed / total) * 100);
};

export const showSeasonEpisodeCountLabel = (season: ShowSeason) => {
	const { total, hasMore } = showSeasonCompletion(season);
	if (total === 0) {
		return undefined;
	}
	return hasMore ? `${total}+ episodes` : `${total} ${total === 1 ? "episode" : "episodes"}`;
};

export const showSeasonCompletedLabel = (season: ShowSeason) => {
	const { completed } = showSeasonCompletion(season);
	return completed === 0 ? undefined : `${completed} watched`;
};

export const showNextUpEpisode = (seasons: ShowSeasonList) => {
	const episodes = seasons
		.filter((season) => !isSpecialsSeason(season))
		.flatMap((season) => season.episodes.items);
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

const optionalText = (value: string | null) =>
	value === null || value.trim() === "" ? undefined : value;

const mediaDateLabel = (value: string | null) => {
	const text = optionalText(value);
	if (text === undefined) {
		return undefined;
	}
	const parsed = dayjs(text);
	return parsed.isValid() ? parsed.format("MMM D, YYYY") : text;
};

export const showSeasonDescription = (season: ShowSeason) => optionalText(season.description);

export const showEpisodeSynopsis = (episode: ShowEpisode) => optionalText(episode.description);

export const showSeasonReleaseLabel = (season: ShowSeason) => mediaDateLabel(season.releaseDate);

export const showEpisodeAirDateLabel = (episode: ShowEpisode) =>
	mediaDateLabel(episode.publishDate);

export const showEpisodeRuntimeLabel = (episode: ShowEpisode) =>
	episode.runtime === null ? undefined : `${episode.runtime} min`;

export const showEpisodeNumberLabel = (episode: ShowEpisode) => `E${episode.episodeNumber}`;

export const showEpisodeOriginLabel = (episode: ShowEpisode) =>
	`S${episode.seasonNumber} • E${episode.episodeNumber}`;

export const showEpisodeStateLabel = (state: ShowEpisode["state"]) =>
	Match.value(state).pipe(
		Match.when("untracked", () => undefined),
		Match.when("in_progress", () => "In progress"),
		Match.when("complete", () => "Watched"),
		Match.exhaustive,
	);

export const showSeasonAsset = (season: ShowSeason) =>
	preferredMediaImageAsset(season.images, "cover");

export const showEpisodeAsset = (episode: ShowEpisode) =>
	preferredMediaImageAsset(episode.images, "still");

export const showEpisodesManagedAssets = (seasons: ShowSeasonList) =>
	canonicalManagedAssets(
		seasons
			.flatMap((season) => [
				showSeasonAsset(season),
				...season.episodes.items.map(showEpisodeAsset),
			])
			.flatMap((asset) => (asset === undefined || asset.type === "remote" ? [] : [asset])),
	);
