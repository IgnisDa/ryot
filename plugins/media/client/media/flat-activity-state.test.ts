import { assert, describe, expect, it } from "vitest";

import {
	decodeFlatActivity,
	decodeUngroupedFlatActivity,
	emptyFlatActivity,
	flatBacklogEventRow,
	flatChapterProgressEventRow,
	flatCollectionAddedEventRow,
	flatCompletionEventRow,
	flatProgressEventRow,
	flatReviewEventRow,
	repeatedFlatActivity,
} from "../../tests/client/flat-media/activity-fixture";
import {
	fixtureSchema,
	ungroupedFixtureSchema,
} from "../../tests/client/flat-media/schema-fixture";
import { readyQueryResult } from "../../tests/client/query-result-fixture";
import type { MediaFlatSchemaActivityView, MediaFlatSchemaRow } from "./flat-schema";

const viewOf = (input: Parameters<typeof decodeFlatActivity>[0] = {}) => {
	const view = fixtureSchema.activityView(decodeFlatActivity(input));
	assert(view !== undefined, "Expected a ready activity view");
	return view;
};

const allRows = (view: MediaFlatSchemaActivityView): readonly MediaFlatSchemaRow[] =>
	view.timeline.layout === "flat"
		? view.timeline.rows
		: [...(view.timeline.open ?? []), ...view.timeline.completed.flatMap((pass) => pass.rows)];

const labelsOf = (view: MediaFlatSchemaActivityView) =>
	allRows(view).map(fixtureSchema.activityRowLabel);

describe("flat media activity state", () => {
	it("reports an empty record when nothing was ever tracked", () => {
		expect(fixtureSchema.activityView(emptyFlatActivity())).toBeUndefined();
		expect(fixtureSchema.mapActivity(readyQueryResult(emptyFlatActivity()))).toEqual({
			status: "empty",
		});
	});

	it("builds beats, progress, completions, reviews and collection changes into one timeline", () => {
		expect(labelsOf(viewOf())).toEqual([
			"Reviewed the item",
			"Finished the item",
			"42% through the item",
			"Added to the Watchlist collection",
			"Added to backlog",
			"Added to media library",
		]);
	});

	it("labels dropped and on-hold beats with the descriptor's copy", () => {
		const view = viewOf({
			collectionEvents: [],
			events: [
				{ ...flatBacklogEventRow, id: "dropped", eventSchemaSlug: "dropped" },
				{ ...flatBacklogEventRow, id: "on-hold", eventSchemaSlug: "on_hold" },
			],
		});

		expect(labelsOf(view)).toEqual(
			expect.arrayContaining(["Put this item on hold", "Stopped the item"]),
		);
	});

	it("carries the consumption source on progress rows only", () => {
		const progress = allRows(viewOf()).find((row) => row.type === "progress");

		assert(progress?.type === "progress");
		expect(progress.source).toBe("Jellyfin");
		expect(progress.percent).toBe(42);
	});

	it("reads a progress event with no recorded percent as part-way through", () => {
		const view = viewOf({
			collectionEvents: [],
			events: [{ ...flatProgressEventRow, progressPercent: null }],
		});

		expect(labelsOf(view)).toEqual(["Part-way through the item"]);
	});

	it("keeps the review body and rating the reviewer recorded", () => {
		const review = allRows(viewOf()).find((row) => row.type === "review");

		assert(review?.type === "review");
		expect(review.rating).toBe(91);
		expect(review.body).toEqual({ isSpoiler: false, text: "The twist still lands." });
	});

	it("segments a repeated item into one timeline block per completion", () => {
		const view = fixtureSchema.activityView(repeatedFlatActivity());

		assert(view?.timeline.layout === "segmented");
		expect(view.timeline.completed.map((pass) => pass.completion.key)).toEqual([
			"completion-media-complete-repeat",
			"completion-media-complete",
		]);
	});

	it("keeps a single completion on the flat layout", () => {
		expect(viewOf().timeline.layout).toBe("flat");
	});

	it("reads completion totals and the consumed amount from the recipe rather than the loaded rows", () => {
		const view = viewOf({
			completionCount: 4,
			consumedAmount: 676,
			unknownAmountCount: 2,
			events: [flatBacklogEventRow],
		});

		expect(view.summary.completions).toBe(4);
		expect(view.summary.amount).toEqual({ total: 676, missing: 2 });
	});

	it("reads an absent consumed amount as zero", () => {
		expect(viewOf({ consumedAmount: null }).summary.amount).toEqual({ total: 0, missing: 0 });
	});

	it("reports a bounded span across the tracked range", () => {
		const { span } = viewOf().summary;

		assert(span.bound === "full");
		expect(span.days).toBe(5);
	});

	it("reports only the latest activity when the event window is truncated", () => {
		expect(viewOf({ truncated: true }).summary.span).toEqual({
			bound: "partial",
			latest: flatReviewEventRow.occurredAt,
		});
	});

	it("carries a schema's own event fields on its progress rows", () => {
		const view = ungroupedFixtureSchema.activityView(
			decodeUngroupedFlatActivity([flatChapterProgressEventRow]),
		);
		const progress = view?.timeline.layout === "flat" ? view.timeline.rows[0] : undefined;

		assert(progress?.type === "progress");
		expect(progress.extra.fixtureChapter).toBe(45);
		expect(ungroupedFixtureSchema.activityRowLabel(progress)).toBe("Chapter 45");
	});

	it("labels a collection removal apart from an addition", () => {
		const view = viewOf({
			events: [flatCompletionEventRow],
			collectionEvents: [
				{ ...flatCollectionAddedEventRow, eventSchemaSlug: "remove-entity-from-collection" },
			],
		});

		expect(labelsOf(view)).toContain("Removed from the Watchlist collection");
	});
});
