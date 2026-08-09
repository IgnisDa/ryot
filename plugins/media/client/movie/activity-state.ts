import type { RyotQueryResult } from "@ryot-app/client-sdk/react";

import type { MovieActivityEvent, MovieActivityResult } from "../../shared/movie-recipes";
import {
	activitySpan,
	anchorOf,
	decimalLabel,
	mediaActivityTimeline,
	mediaBeatRow,
	mediaCollectionRow,
	mediaCompletionRow,
	mediaReviewRow,
	nonEmpty,
	optionalText,
	type ActivityAnchor,
	type MediaActivityBeatRow,
	type MediaActivityCollectionRow,
	type MediaActivityCompletionRow,
	type MediaActivityReviewRow,
	type MediaActivitySpan,
	type MediaActivityTimeline,
	type NonEmpty,
} from "../media/activity-timeline";
import { classifyRyotQueryResult, type MappedRyotQueryState } from "../media/query-state";

type MovieEvent = Extract<MovieActivityEvent, { kind: "movie" }>;
type CollectionEvent = Extract<MovieActivityEvent, { kind: "collection" }>;

type ActivityBeat = Exclude<MovieEvent["eventSchemaSlug"], "review" | "complete" | "progress">;

type MovieActivityProgressRow = ActivityAnchor & {
	readonly type: "progress";
	readonly source: string | undefined;
	readonly percent: number | undefined;
};

export type MovieActivityReviewRow = MediaActivityReviewRow<{ readonly on: "movie" }>;

export type MovieActivityRow =
	| MovieActivityReviewRow
	| MovieActivityProgressRow
	| MediaActivityCollectionRow
	| MediaActivityCompletionRow
	| MediaActivityBeatRow<ActivityBeat>;

export type MovieActivityTimeline = MediaActivityTimeline<MovieActivityRow>;

export type MovieActivitySummary = {
	readonly watches: number;
	readonly span: MediaActivitySpan;
	readonly minutes: { readonly total: number; readonly missing: number };
};

export type MovieActivityView = {
	readonly summary: MovieActivitySummary;
	readonly timeline: MovieActivityTimeline;
};

export type MovieActivityState = MappedRyotQueryState<
	{ readonly status: "empty" } | { readonly status: "ready"; readonly view: MovieActivityView }
>;

const movieEventRow = (event: MovieEvent): MovieActivityRow => {
	if (event.eventSchemaSlug === "complete") {
		return mediaCompletionRow(event);
	}
	if (event.eventSchemaSlug === "review") {
		return mediaReviewRow(event, { on: "movie" });
	}
	if (event.eventSchemaSlug === "progress") {
		return {
			...anchorOf(event, "progress"),
			type: "progress",
			source: optionalText(event.consumedOn),
			percent: event.progressPercent ?? undefined,
		};
	}
	return mediaBeatRow(event, event.eventSchemaSlug);
};

const collectionEventRow = (event: CollectionEvent): MovieActivityRow => mediaCollectionRow(event);

const activityRow = (event: MovieActivityEvent): MovieActivityRow =>
	event.kind === "movie" ? movieEventRow(event) : collectionEventRow(event);

const movieActivityPredicates = {
	isWatching: (row: MovieActivityRow) => row.type === "progress",
	isCompletion: (row: MovieActivityRow) => row.type === "completion",
};

const movieActivitySummary = (input: {
	readonly result: MovieActivityResult;
	readonly rows: NonEmpty<MovieActivityRow>;
}): MovieActivitySummary => ({
	watches: input.result.watchCount,
	span: activitySpan(input.rows, input.result.truncated),
	minutes: { total: input.result.watchedMinutes ?? 0, missing: input.result.watchedUnknownRuntime },
});

export const movieActivityView = (result: MovieActivityResult): MovieActivityView | undefined => {
	const rows = result.events
		.map(activityRow)
		.sort(
			(left, right) =>
				right.occurredAt.localeCompare(left.occurredAt) || left.key.localeCompare(right.key),
		);
	const spanned = nonEmpty(rows);
	const timeline = mediaActivityTimeline(rows, movieActivityPredicates);
	if (timeline === undefined || spanned === undefined) {
		return undefined;
	}
	return { timeline, summary: movieActivitySummary({ result, rows: spanned }) };
};

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

const BEAT_LABELS: Record<ActivityBeat, string> = {
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

export const movieActivityWatchesLabel = (summary: MovieActivitySummary) => `${summary.watches}`;
