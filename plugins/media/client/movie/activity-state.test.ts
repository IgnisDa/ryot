import { assert, describe, expect, it } from "vitest";

import {
	collectionAddedEventRow,
	decodeMovieActivity,
	emptyMovieActivity,
	movieBacklogEventRow,
	movieCompletionEventRow,
	movieProgressEventRow,
	movieReviewEventRow,
	rewatchedMovieActivity,
} from "../../tests/client/movie/activity-fixture";
import { readyQueryResult } from "../../tests/client/query-result-fixture";
import { mediaActivityTimeLabel } from "../media/activity-timeline";
import {
	mapMovieActivity,
	movieActivityRowLabel,
	movieActivityView,
	type MovieActivityRow,
	type MovieActivityView,
} from "./activity-state";

const viewOf = (input: Parameters<typeof decodeMovieActivity>[0] = {}) => {
	const view = movieActivityView(decodeMovieActivity(input));
	assert(view !== undefined, "Expected a ready activity view");
	return view;
};

const allRows = (view: MovieActivityView): readonly MovieActivityRow[] =>
	view.timeline.layout === "flat"
		? view.timeline.rows
		: [...(view.timeline.open ?? []), ...view.timeline.completed.flatMap((watch) => watch.rows)];

const labelsOf = (view: MovieActivityView) => allRows(view).map(movieActivityRowLabel);

describe("movie activity state", () => {
	it("reports an empty record when nothing was ever tracked", () => {
		expect(movieActivityView(emptyMovieActivity())).toBeUndefined();
		expect(mapMovieActivity(readyQueryResult(emptyMovieActivity()))).toEqual({ status: "empty" });
	});

	it("builds beats, progress, completions, reviews and collection changes into one timeline", () => {
		expect(labelsOf(viewOf())).toEqual([
			"Reviewed the movie",
			"Finished the movie",
			"42% through the movie",
			"Added to the Watchlist collection",
			"Added to backlog",
		]);
	});

	it("carries the consumption source on progress rows only", () => {
		const rows = allRows(viewOf());
		const progress = rows.find((row) => row.type === "progress");

		assert(progress?.type === "progress");
		expect(progress.source).toBe("Jellyfin");
		expect(progress.percent).toBe(42);
	});

	it("reads a progress event with no recorded percent as part-way through", () => {
		const view = viewOf({
			collectionEvents: [],
			movieEvents: [{ ...movieProgressEventRow, progressPercent: null }],
		});

		expect(labelsOf(view)).toEqual(["Part-way through the movie"]);
	});

	it("keeps the review body and rating the reviewer recorded", () => {
		const review = allRows(viewOf()).find((row) => row.type === "review");

		assert(review?.type === "review");
		expect(review.subject).toEqual({ on: "movie" });
		expect(review.rating).toBe(91);
		expect(review.body).toEqual({ isSpoiler: false, text: "The twist still lands." });
	});

	it("segments a rewatched movie into one timeline block per completion", () => {
		const view = movieActivityView(rewatchedMovieActivity());

		assert(view?.timeline.layout === "segmented");
		expect(view.timeline.completed).toHaveLength(2);
		expect(view.timeline.completed.map((watch) => watch.completion.key)).toEqual([
			"completion-movie-complete-rewatch",
			"completion-movie-complete",
		]);
	});

	it("keeps a single-watch movie on the flat layout", () => {
		expect(viewOf().timeline.layout).toBe("flat");
	});

	it("reads watch totals and minutes from the recipe rather than the loaded rows", () => {
		const view = viewOf({
			watchCount: 4,
			watchedMinutes: 676,
			movieEvents: [movieBacklogEventRow],
		});

		expect(view.summary.completions).toBe(4);
		expect(view.summary.minutes).toEqual({ total: 676, missing: 0 });
		expect(mediaActivityTimeLabel(view.summary.minutes)).toBe("11h 16m");
	});

	it("marks the total as a floor when a completion has no known length", () => {
		const view = viewOf({ watchedMinutes: 169, watchedUnknownRuntime: 1 });

		expect(mediaActivityTimeLabel(view.summary.minutes)).toBe("2h 49m+");
	});

	it("reports a bounded span across the tracked range", () => {
		const view = viewOf();

		assert(view.summary.span.bound === "full");
		expect(view.summary.span.days).toBe(5);
	});

	it("reports only the latest activity when the event window is truncated", () => {
		expect(viewOf({ truncated: true }).summary.span).toEqual({
			bound: "partial",
			latest: movieReviewEventRow.occurredAt,
		});
	});

	it("labels a collection removal apart from an addition", () => {
		const view = viewOf({
			movieEvents: [movieCompletionEventRow],
			collectionEvents: [
				{ ...collectionAddedEventRow, eventSchemaSlug: "remove-entity-from-collection" },
			],
		});

		expect(labelsOf(view)).toContain("Removed from the Watchlist collection");
	});
});
