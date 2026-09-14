import { assert, describe, expect, it } from "vitest";

import {
	collectionAddedEventRow,
	collectionRemovedEventRow,
	decodeShowActivity,
	emptyShowActivity,
	episodeReviewEventRow,
	firstWatchDayRow,
	regularSeasonRow,
	rewatchCompletionEventRow,
	rewatchWatchDayRow,
	rewatchedShowActivity,
	sameDayWatchRow,
	showBacklogEventRow,
	showCompletionEventRow,
	showDroppedEventRow,
	showOnHoldEventRow,
	showReviewEventRow,
	specialProgressRow,
	secondWatchDayRow,
	specialsSeasonRow,
} from "../../tests/client/show/activity-fixture";
import { mediaActivitySpanLabel, mediaActivityTimeLabel } from "../media/activity-timeline";
import {
	showActivityCoverage,
	showActivityEpisodesLabel,
	showActivityRowLabel,
	showActivityView,
	type ShowActivityRow,
	type ShowActivityView,
	type ShowActivityWatchRow,
} from "./activity-state";

const viewOf = (input: Parameters<typeof decodeShowActivity>[0] = {}) => {
	const view = showActivityView(decodeShowActivity(input));
	assert(view !== undefined, "Expected a ready activity view");
	return view;
};

const allRows = (view: ShowActivityView): readonly ShowActivityRow[] =>
	view.timeline.layout === "flat"
		? view.timeline.rows
		: [...(view.timeline.open ?? []), ...view.timeline.completed.flatMap((watch) => watch.rows)];

const labelsOf = (view: ShowActivityView) => allRows(view).map(showActivityRowLabel);

const watchRows = (view: ShowActivityView) =>
	allRows(view).filter((row): row is ShowActivityWatchRow => row.type === "watch");

describe("show activity progress rows", () => {
	it("keeps a progress event the engine still reports as in flight", () => {
		const view = viewOf({
			watchDays: [],
			parentEvents: [],
			episodeEvents: [],
			collectionEvents: [],
			episodeProgress: [specialProgressRow],
		});

		expect(labelsOf(view)).toEqual(["40% through Specials • E3 · Making Adolescence"]);
	});
});

describe("show activity watch days", () => {
	it("reads a day of watching as one row listing its episodes in order", () => {
		const view = viewOf({
			parentEvents: [],
			episodeEvents: [],
			episodeProgress: [],
			collectionEvents: [],
			watchDays: [firstWatchDayRow, sameDayWatchRow],
		});
		const [session] = watchRows(view);
		assert(session !== undefined);

		expect(watchRows(view)).toHaveLength(1);
		expect(session.episodes.map((episode) => episode.origin)).toEqual(["S1 • E1", "S1 • E2"]);
		expect(showActivityRowLabel(session)).toBe("Watched 2 episodes");
	});

	it("keeps separate days as separate rows", () => {
		const view = viewOf({
			parentEvents: [],
			episodeEvents: [],
			episodeProgress: [],
			collectionEvents: [],
			watchDays: [firstWatchDayRow, secondWatchDayRow],
		});

		expect(watchRows(view)).toHaveLength(2);
	});

	it("prefers logged time over episode length for each watched episode", () => {
		const view = viewOf({
			parentEvents: [],
			episodeEvents: [],
			episodeProgress: [],
			collectionEvents: [],
			watchDays: [firstWatchDayRow, sameDayWatchRow],
		});
		const [session] = watchRows(view);
		assert(session !== undefined);

		expect(session.episodes.map((episode) => episode.minutes)).toEqual([66, 61]);
	});

	it("lists an episode once even when a day holds more than one source", () => {
		const view = viewOf({
			parentEvents: [],
			episodeEvents: [],
			episodeProgress: [],
			collectionEvents: [],
			watchDays: [firstWatchDayRow, { ...firstWatchDayRow, consumedOn: "Netflix" }],
		});
		const [session] = watchRows(view);
		assert(session !== undefined);

		expect(session.episodes).toHaveLength(1);
		expect(session.source).toBe("Jellyfin");
	});
});

describe("show activity watch segmentation", () => {
	it("stays flat for a single completed watch", () => {
		expect(viewOf().timeline.layout).toBe("flat");
	});

	it("segments once a second watch is completed", () => {
		const view = showActivityView(rewatchedShowActivity());
		assert(view?.timeline.layout === "segmented");

		expect(view.timeline.completed).toHaveLength(2);
		expect(view.timeline.open).toBeUndefined();
	});

	it("files a day of watching under the watch that closed it", () => {
		const view = showActivityView(
			decodeShowActivity({
				watchCount: 2,
				episodeEvents: [],
				episodeProgress: [],
				collectionEvents: [],
				parentEvents: [showCompletionEventRow, rewatchCompletionEventRow],
				watchDays: [rewatchWatchDayRow, { ...firstWatchDayRow, day: "2025-11-06T00:00:00.000Z" }],
			}),
		);
		assert(view?.timeline.layout === "segmented");
		const [newest, older] = view.timeline.completed;

		expect(newest.rows.filter((row) => row.type === "watch")).toHaveLength(1);
		expect(older.rows.filter((row) => row.type === "watch")).toHaveLength(1);
	});

	it("never opens a watch for a collection change alone", () => {
		const view = viewOf({
			episodeEvents: [],
			episodeProgress: [],
			watchDays: [firstWatchDayRow],
			parentEvents: [showCompletionEventRow],
			collectionEvents: [
				{ ...collectionAddedEventRow, occurredAt: "2026-06-13T09:00:00.000Z" },
				{ ...collectionRemovedEventRow, occurredAt: "2026-06-14T09:00:00.000Z" },
			],
		});

		expect(view.timeline.layout).toBe("flat");
		expect(view.summary.watches).toBe(1);
	});

	it("never opens a watch for a review recorded after the last completion", () => {
		const view = showActivityView(
			decodeShowActivity({
				episodeEvents: [],
				episodeProgress: [],
				collectionEvents: [],
				watchDays: [firstWatchDayRow, rewatchWatchDayRow],
				parentEvents: [
					showCompletionEventRow,
					{ ...showReviewEventRow, occurredAt: "2026-04-01T12:00:00.000Z" },
					{
						...showCompletionEventRow,
						id: "show-complete-2",
						occurredAt: "2026-03-02T12:00:00.000Z",
					},
				],
			}),
		);
		assert(view?.timeline.layout === "segmented");

		expect(view.timeline.open).toBeUndefined();
	});
});

describe("show activity coverage", () => {
	it("keeps specials out of the headline total", () => {
		const coverage = showActivityCoverage(decodeShowActivity());

		expect(coverage.headline).toEqual({ total: 4, watched: 2 });
		expect(coverage.specials).toMatchObject({ total: 2, watched: 0, label: "Specials" });
		expect(coverage.seasons.map((season) => season.seasonNumber)).toEqual([1]);
	});

	it("orders seasons with specials last", () => {
		const coverage = showActivityCoverage(
			decodeShowActivity({
				seasons: [
					specialsSeasonRow,
					regularSeasonRow,
					{ ...regularSeasonRow, id: "season-2", seasonNumber: 2 },
				],
			}),
		);

		expect([...coverage.seasons, coverage.specials].map((season) => season?.label)).toEqual([
			"Season 1",
			"Season 2",
			"Specials",
		]);
	});

	it("reports an unknown headline total for a show with no regular seasons", () => {
		const coverage = showActivityCoverage(decodeShowActivity({ seasons: [specialsSeasonRow] }));

		expect(coverage.headline.total).toBeUndefined();
		expect(coverage.specials).toBeDefined();
	});

	it("reports coverage as a percentage of each season", () => {
		const coverage = showActivityCoverage(decodeShowActivity());

		expect(coverage.seasons[0]).toMatchObject({ total: 4, watched: 2, percent: 50 });
	});
});

describe("show activity summary", () => {
	it("reads the watch count from the engine rather than the fetched page", () => {
		expect(viewOf({ watchCount: 3, parentEvents: [] }).summary.watches).toBe(3);
	});

	it("totals watched runtime across every season, specials included", () => {
		const view = viewOf({
			seasons: [{ ...specialsSeasonRow, watchedTotal: 1, watchedMinutes: 20 }, regularSeasonRow],
		});

		expect(view.summary.minutes).toEqual({ total: 136, missing: 0 });
		expect(mediaActivityTimeLabel(view.summary.minutes)).toBe("2h 16m");
	});

	it("marks the total as a floor when a watched episode has no known length", () => {
		const view = viewOf({
			seasons: [{ ...regularSeasonRow, watchedMinutes: 55, watchedUnknownRuntime: 1 }],
		});

		expect(view.summary.minutes).toEqual({ total: 55, missing: 1 });
		expect(mediaActivityTimeLabel(view.summary.minutes)).toBe("55m+");
	});

	it("reports a bounded span as days across the tracked range", () => {
		const view = viewOf();

		assert(view.summary.span.bound === "full");
		expect(view.summary.span.days).toBe(8);
		expect(mediaActivitySpanLabel(view.summary.span)).toEqual({
			label: "Span",
			value: "8 days",
			detail: "Nov 1 – Nov 8, 2025",
		});
	});

	it("reports only the latest activity when the window is truncated", () => {
		const view = viewOf({ truncated: true });

		expect(view.summary.span).toEqual({ bound: "partial", latest: "2025-11-08T12:00:00.000Z" });
		expect(mediaActivitySpanLabel(view.summary.span)).toEqual({
			label: "Latest",
			detail: undefined,
			value: "Nov 8, 2025",
		});
	});

	it("keeps the episode count exact even when the event window is truncated", () => {
		const view = viewOf({ truncated: true });

		expect(showActivityEpisodesLabel(view.summary)).toBe("2 / 4");
	});
});

describe("show activity labels", () => {
	it("names every lifecycle beat", () => {
		const view = viewOf({
			watchDays: [],
			episodeEvents: [],
			episodeProgress: [],
			collectionEvents: [],
			parentEvents: [showBacklogEventRow, showOnHoldEventRow, showDroppedEventRow],
		});

		expect(labelsOf(view)).toEqual([
			"Stopped watching",
			"Put this show on hold",
			"Added to backlog",
		]);
	});

	it("names collection changes in both directions", () => {
		const view = viewOf({
			watchDays: [],
			parentEvents: [],
			episodeEvents: [],
			episodeProgress: [],
			collectionEvents: [collectionRemovedEventRow, collectionAddedEventRow],
		});

		expect(labelsOf(view)).toEqual([
			"Removed from the Watchlist collection",
			"Added to the Watchlist collection",
		]);
	});

	it("hides a review body that holds no text even when flagged as a spoiler", () => {
		const view = viewOf({
			parentEvents: [],
			episodeProgress: [],
			collectionEvents: [],
			episodeEvents: [{ ...episodeReviewEventRow, text: "   " }],
		});
		const [review] = allRows(view);

		assert(review?.type === "review");
		expect(review.body).toBeUndefined();
		expect(review.rating).toBe(90);
	});
});

describe("show activity states", () => {
	it("reports an empty record when nothing was ever tracked", () => {
		expect(showActivityView(emptyShowActivity())).toBeUndefined();
	});
});
