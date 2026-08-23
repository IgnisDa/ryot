import { assert, describe, expect, it } from "vitest";

import {
	decodeEpisodicActivity,
	emptyEpisodicActivity,
	episodicFirstWatchDayRow,
	episodicSameDayWatchRow,
	rewatchedEpisodicActivity,
} from "../../tests/client/episodic/activity-fixture";
import { episodicFixtureSchema } from "../../tests/client/episodic/schema-fixture";
import {
	malformedQueryResult,
	pendingQueryResult,
	readyQueryResult,
	transportErrorQueryResult,
} from "../../tests/client/query-result-fixture";
import { mediaEpisodicEpisodesLabel } from "./episodic-activity-state";

const view = (input: Parameters<typeof decodeEpisodicActivity>[0] = {}) => {
	const mapped = episodicFixtureSchema.activityView(decodeEpisodicActivity(input));
	assert(mapped !== undefined);
	return mapped;
};

describe("episodic activity state", () => {
	it("maps query failures apart and reports an unrecorded history as empty", () => {
		expect(episodicFixtureSchema.mapActivity(pendingQueryResult())).toEqual({ status: "loading" });
		expect(episodicFixtureSchema.mapActivity(malformedQueryResult()).status).toBe("malformed");
		expect(episodicFixtureSchema.mapActivity(transportErrorQueryResult()).status).toBe(
			"transport-error",
		);
		expect(episodicFixtureSchema.mapActivity(readyQueryResult(emptyEpisodicActivity()))).toEqual({
			status: "empty",
		});
	});

	it("collapses a day of episode completions into one entry listing its episodes", () => {
		const day = view({
			parentEvents: [],
			episodeEvents: [],
			episodeProgress: [],
			collectionEvents: [],
			watchDays: [episodicFirstWatchDayRow, episodicSameDayWatchRow],
		});
		assert(day.timeline.layout === "flat");
		const [row] = day.timeline.rows;
		assert(row.type === "watch");

		expect(row.source).toBe("Jellyfin");
		expect(row.episodes.map(({ name }) => name)).toEqual([
			"Episode 1: The Arrest",
			"Episode 2: The Interview",
		]);
		expect(episodicFixtureSchema.activityRowLabel(row)).toBe("Heard 2 episodes");
	});

	it("names the episode a single-episode day belongs to", () => {
		const single = view({
			parentEvents: [],
			episodeEvents: [],
			episodeProgress: [],
			collectionEvents: [],
			watchDays: [episodicFirstWatchDayRow],
		});
		assert(single.timeline.layout === "flat");
		const labels = single.timeline.rows.map(episodicFixtureSchema.activityRowLabel);

		expect(labels).toEqual(["Heard Ep 1 · Episode 1: The Arrest"]);
	});

	it("labels every row kind from the schema's own copy", () => {
		const full = view({ watchDays: [] });
		const rows =
			full.timeline.layout === "flat" ? full.timeline.rows : full.timeline.completed[0].rows;
		const labels = rows.map(episodicFixtureSchema.activityRowLabel);

		expect(labels).toContain("Reviewed the item");
		expect(labels).toContain("Finished the item");
		expect(labels).toContain("Reviewed Episode 1: The Arrest");
		expect(labels).toContain("40% through Ep 3 · Behind the scenes");
		expect(labels).toContain("Added to the Watchlist collection");
		expect(labels).toContain("Added to media library");
	});

	it("names the beats the parent recorded", () => {
		const beats = view({
			watchDays: [],
			episodeEvents: [],
			episodeProgress: [],
			collectionEvents: [],
			parentEvents: [
				{
					text: null,
					rating: null,
					timeSpent: null,
					startedOn: null,
					isSpoiler: null,
					consumedOn: null,
					completedOn: null,
					id: "parent-dropped",
					eventSchemaSlug: "dropped",
					createdAt: "2025-11-03T12:00:05.000Z",
					occurredAt: "2025-11-03T12:00:00.000Z",
				},
			],
		});
		assert(beats.timeline.layout === "flat");

		expect(beats.timeline.rows.map(episodicFixtureSchema.activityRowLabel)).toEqual([
			"Stopped the item",
		]);
	});

	it("summarises coverage, watches and minutes from the schema's coverage mapping", () => {
		const summary = view().summary;

		expect(summary.watches).toBe(1);
		expect(summary.minutes).toEqual({ total: 116, missing: 0 });
		expect(mediaEpisodicEpisodesLabel(summary)).toBe("2 / 4");
		expect(view().coverage).toEqual([
			{ total: 4, watched: 2, percent: 50, key: "parent-1", label: "Episodes" },
		]);
	});

	it("separates passes only once a second one is completed", () => {
		const rewatched = episodicFixtureSchema.activityView(rewatchedEpisodicActivity());
		assert(rewatched !== undefined);

		expect(rewatched.timeline.layout).toBe("segmented");
		expect(view().timeline.layout).toBe("flat");
	});

	it("marks a truncated window as partial", () => {
		expect(view({ truncated: true }).summary.span.bound).toBe("partial");
		expect(view().summary.span.bound).toBe("full");
	});
});
