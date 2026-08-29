import { assert, describe, expect, it } from "vitest";

import {
	decodeMusicActivity,
	emptyMusicActivity,
	musicBacklogEventRow,
	musicCollectionAddedEventRow,
	musicCompletionEventRow,
	musicProgressEventRow,
	musicReviewEventRow,
	relistenedMusicActivity,
} from "../../tests/client/music/activity-fixture";
import { readyQueryResult } from "../../tests/client/query-result-fixture";
import { mediaActivityTimeLabel } from "../media/activity-timeline";
import {
	mapMusicActivity,
	musicActivityRowLabel,
	musicActivityView,
	type MusicActivityRow,
	type MusicActivityView,
} from "./activity-state";

const viewOf = (input: Parameters<typeof decodeMusicActivity>[0] = {}) => {
	const view = musicActivityView(decodeMusicActivity(input));
	assert(view !== undefined, "Expected a ready activity view");
	return view;
};

const allRows = (view: MusicActivityView): readonly MusicActivityRow[] =>
	view.timeline.layout === "flat"
		? view.timeline.rows
		: [...(view.timeline.open ?? []), ...view.timeline.completed.flatMap((watch) => watch.rows)];

const labelsOf = (view: MusicActivityView) => allRows(view).map(musicActivityRowLabel);

describe("music activity state", () => {
	it("reports an empty record when nothing was ever tracked", () => {
		expect(musicActivityView(emptyMusicActivity())).toBeUndefined();
		expect(mapMusicActivity(readyQueryResult(emptyMusicActivity()))).toEqual({ status: "empty" });
	});

	it("labels beats, progress, completions, reviews and collection changes for a track", () => {
		expect(labelsOf(viewOf())).toEqual([
			"Reviewed the track",
			"Finished the track",
			"42% through the track",
			"Added to the Favourites collection",
			"Added to backlog",
		]);
	});

	it("carries the consumption source on progress rows only", () => {
		const progress = allRows(viewOf()).find((row) => row.type === "progress");

		assert(progress?.type === "progress");
		expect(progress.source).toBe("Spotify");
		expect(progress.percent).toBe(42);
	});

	it("reads a progress event with no recorded percent as part-way through", () => {
		expect(
			labelsOf(
				viewOf({
					collectionEvents: [],
					musicEvents: [{ ...musicProgressEventRow, progressPercent: null }],
				}),
			),
		).toEqual(["Part-way through the track"]);
	});

	it("keeps the review body and rating the reviewer recorded", () => {
		const review = allRows(viewOf()).find((row) => row.type === "review");

		assert(review?.type === "review");
		expect(review.subject).toEqual({ on: "music" });
		expect(review.rating).toBe(96);
		expect(review.body).toEqual({ isSpoiler: false, text: "Three songs in one." });
	});

	it("segments a relistened track into one timeline block per completion", () => {
		const view = musicActivityView(relistenedMusicActivity());

		assert(view?.timeline.layout === "segmented");
		expect(view.timeline.completed.map((watch) => watch.completion.key)).toEqual([
			"completion-music-complete-relisten",
			"completion-music-complete",
		]);
	});

	it("rounds the fractional minute total once rather than per listen", () => {
		const view = viewOf({
			completionCount: 12,
			consumedMinutes: 44.4,
			musicEvents: [musicBacklogEventRow],
		});

		expect(view.summary.completions).toBe(12);
		expect(mediaActivityTimeLabel(view.summary.minutes)).toBe("44m");
	});

	it("marks the total as a floor when a completion has no known length", () => {
		expect(
			mediaActivityTimeLabel(
				viewOf({ consumedMinutes: 3.7, unknownDurationCount: 1 }).summary.minutes,
			),
		).toBe("4m+");
	});

	it("reports only the latest activity when the event window is truncated", () => {
		expect(viewOf({ truncated: true }).summary.span).toEqual({
			bound: "partial",
			latest: musicReviewEventRow.occurredAt,
		});
	});

	it("labels a collection removal apart from an addition", () => {
		expect(
			labelsOf(
				viewOf({
					musicEvents: [musicCompletionEventRow],
					collectionEvents: [
						{ ...musicCollectionAddedEventRow, eventSchemaSlug: "remove-entity-from-collection" },
					],
				}),
			),
		).toContain("Removed from the Favourites collection");
	});
});
