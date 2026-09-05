import type { ShowSummaryResult } from "../../shared/show-recipes";
import {
	mediaCountFact,
	mediaCountLabel,
	mediaSummaryStateMapper,
	type MediaSummaryState,
} from "../media/summary-state";

export type ShowSummary = NonNullable<ShowSummaryResult["show"]>;

export type ShowSummaryState = MediaSummaryState<ShowSummary>;

export const SHOW_TYPE_LABEL = "TV Show";

const showSummaryState = mediaSummaryStateMapper<ShowSummaryResult, ShowSummary>({
	title: "Show",
	plural: "shows",
	singular: "show",
	select: ({ show }) => show,
});

export const mapShowSummary = showSummaryState.mapSummary;

export const showSummaryError = showSummaryState.summaryError;

export const showSummaryUnavailable = showSummaryState.summaryUnavailable;

const LIFECYCLE_LABELS: Record<ShowSummary["state"], string> = {
	on_hold: "On hold",
	dropped: "Dropped",
	complete: "Complete",
	backlog: "In backlog",
	caught_up: "Caught up",
	untracked: "Not tracked",
	in_progress: "In progress",
};

export const showLifecycleLabel = (state: ShowSummary["state"]) => LIFECYCLE_LABELS[state];

export const showSeasonCountLabel = (show: ShowSummary) =>
	show.totalSeasons === null ? undefined : mediaCountLabel(show.totalSeasons, "season");

export const showEpisodeCountLabel = (show: ShowSummary) =>
	show.totalEpisodes === null ? undefined : mediaCountLabel(show.totalEpisodes, "episode");

export const showSeasonFact = (show: ShowSummary) => mediaCountFact(show.totalSeasons, "Season");

export const showEpisodeFact = (show: ShowSummary) => mediaCountFact(show.totalEpisodes, "Episode");
