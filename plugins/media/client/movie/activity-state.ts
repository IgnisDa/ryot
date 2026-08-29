import type { RyotQueryResult } from "@ryot-app/client-sdk/react";

import type { MovieActivityResult } from "../../shared/movie-recipes";
import type { MediaActivityState } from "../media/activity-tab";
import { decimalLabel, type MediaActivityReviewRow } from "../media/activity-timeline";
import {
	mediaFlatActivityView,
	type MediaFlatActivityBeat,
	type MediaFlatActivityRow,
	type MediaFlatActivitySummary,
	type MediaFlatActivityTimeline,
	type MediaFlatActivityView,
} from "../media/flat-activity-state";
import { classifyRyotQueryResult } from "../media/query-state";

type MovieReviewSubject = { readonly on: "movie" };

const MOVIE_REVIEW_SUBJECT: MovieReviewSubject = { on: "movie" };

export type MovieActivityReviewRow = MediaActivityReviewRow<MovieReviewSubject>;

export type MovieActivityRow = MediaFlatActivityRow<MovieReviewSubject>;

export type MovieActivityTimeline = MediaFlatActivityTimeline<MovieReviewSubject>;

export type MovieActivitySummary = MediaFlatActivitySummary;

export type MovieActivityView = MediaFlatActivityView<MovieReviewSubject>;

export type MovieActivityState = MediaActivityState<MovieActivityView>;

export const movieActivityView = (result: MovieActivityResult) =>
	mediaFlatActivityView({
		events: result.events,
		truncated: result.truncated,
		subject: MOVIE_REVIEW_SUBJECT,
		completions: result.watchCount,
		minutes: { total: result.watchedMinutes ?? 0, missing: result.watchedUnknownRuntime },
	});

export const mapMovieActivity = (
	result: RyotQueryResult<MovieActivityResult>,
): MovieActivityState => {
	const state = classifyRyotQueryResult(result);
	if (state.status !== "ready") {
		return state;
	}
	const view = movieActivityView(state.value);
	return view === undefined ? { status: "empty" } : { view, status: "ready" };
};

const BEAT_LABELS: Record<MediaFlatActivityBeat, string> = {
	backlog: "Added to backlog",
	dropped: "Stopped watching",
	on_hold: "Put this movie on hold",
};

export const movieActivityRowLabel = (row: MovieActivityRow): string => {
	if (row.type === "completion") {
		return "Finished the movie";
	}
	if (row.type === "collection") {
		return row.change === "added"
			? `Added to the ${row.name} collection`
			: `Removed from the ${row.name} collection`;
	}
	if (row.type === "beat") {
		return BEAT_LABELS[row.beat];
	}
	if (row.type === "progress") {
		return row.percent === undefined
			? "Part-way through the movie"
			: `${decimalLabel(row.percent)}% through the movie`;
	}
	return "Reviewed the movie";
};

export const movieActivityWatchesLabel = (summary: MovieActivitySummary) =>
	`${summary.completions}`;
