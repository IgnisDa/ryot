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
import {
	mediaEpisodicActivityFigures,
	mediaEpisodicActivityRow,
	mediaEpisodicEpisodesLabel,
} from "./episodic-activity-state";

const view = (input: Parameters<typeof decodeEpisodicActivity>[0] = {}) => {
	const mapped = episodicFixtureSchema.activityView(decodeEpisodicActivity(input));
	assert(mapped !== undefined);
	return mapped;
};

describe("episodic activity state", () => {
	it("uses canonical zero and missing minutes instead of provider or raw-event duration", () => {
		const episode = decodeEpisodicActivity().events.find((event) => event.kind === "episode");
		assert(episode?.kind === "episode");
		for (const minutes of [0, null]) {
			const row = mediaEpisodicActivityRow(
				{ ...episode, timeSpent: 90, consumptionMinutes: minutes, eventSchemaSlug: "complete" },
				{ order: () => [1], origin: () => "E1" },
			);
			expect(row).toMatchObject({ type: "watch", episodes: [{ minutes: minutes ?? undefined }] });
		}
	});
	it("hides lifetime figures during repair while retaining current episode coverage", () => {
		const summary = view({ consumedAmount: 0, consumptionPendingCount: 1 }).summary;
		expect(summary.processing).toBe("pending");
		expect(mediaEpisodicEpisodesLabel(summary)).toBe("2 / 4");
		const figures = mediaEpisodicActivityFigures(summary, {
			time: "Time",
			current: "Current",
			watches: "Watches",
			episodes: "Episodes",
		});
		expect(figures).toContainEqual({ value: "Updating", detail: undefined, label: "Consumption" });
		expect(figures.some((figure) => figure.label === "Time" || figure.label === "Watches")).toBe(
			false,
		);
	});
	it("adds independent same-day episode quantities without replacing them with runtime", () => {
		const result = view({
			parentEvents: [],
			episodeEvents: [],
			episodeProgress: [],
			collectionEvents: [],
			watchDays: [
				episodicFirstWatchDayRow,
				{ ...episodicFirstWatchDayRow, minutes: 0.25, consumedOn: "Plex" },
			],
		});
		assert(result.timeline.layout === "flat");
		expect(result.timeline.rows[0]).toMatchObject({
			type: "watch",
			episodes: [{ minutes: 66.25 }],
		});
	});
	it("keeps each completion and progress log separate in complete history", () => {
		const episode = decodeEpisodicActivity().events.find((event) => event.kind === "episode");
		assert(episode?.kind === "episode");
		const complete = mediaEpisodicActivityRow(
			{ ...episode, timeSpent: 25, consumptionMinutes: 25, eventSchemaSlug: "complete" },
			{ order: () => [1], origin: () => "E1" },
		);
		expect(complete).toMatchObject({
			type: "watch",
			key: `watch-${episode.id}`,
			episodes: [{ minutes: 25, origin: "E1", id: episode.episode.id }],
		});
		const progress = mediaEpisodicActivityRow(
			{ ...episode, progressPercent: 45, eventSchemaSlug: "progress" },
			{ order: () => [1], origin: () => "E1" },
		);
		expect(progress).toMatchObject({
			percent: 45,
			type: "progress",
			key: `progress-${episode.id}`,
			episode: { origin: "E1", id: episode.episode.id },
		});
	});
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

	it("orders a day of completions by its latest watch, not the start of the day", () => {
		const day = view({
			episodeEvents: [],
			episodeProgress: [],
			collectionEvents: [],
			watchDays: [episodicFirstWatchDayRow, episodicSameDayWatchRow],
			parentEvents: [
				{
					text: null,
					rating: null,
					properties: {},
					timeSpent: null,
					startedOn: null,
					isSpoiler: null,
					consumedOn: null,
					dateUnknown: null,
					entityId: "entity-1",
					id: "parent-library",
					sessionEntityId: null,
					createdAt: "2025-11-04T12:00:05.000Z",
					occurredAt: "2025-11-04T12:00:00.000Z",
					eventSchemaSlug: "add-to-media-library",
				},
			],
		});
		assert(day.timeline.layout === "flat");

		expect(day.timeline.rows.map((row) => [row.type, row.occurredAt])).toEqual([
			["watch", "2025-11-04T22:00:00.000Z"],
			["media-library", "2025-11-04T12:00:00.000Z"],
		]);
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
					properties: {},
					timeSpent: null,
					startedOn: null,
					isSpoiler: null,
					consumedOn: null,
					dateUnknown: null,
					entityId: "entity-1",
					id: "parent-dropped",
					sessionEntityId: null,
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

	it("keeps current coverage separate from lifetime watches and minutes", () => {
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
