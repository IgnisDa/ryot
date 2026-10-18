import { Schema } from "@ryot-app/plugin-kit/effect";
import { EntityId, EventId } from "@ryot-app/plugin-kit/schema";
import { assert, describe, expect, it } from "vitest";

import {
	decodeEpisodicActivity,
	episodicFirstWatchDayRow,
	episodicSameDayWatchRow,
} from "../../tests/client/episodic/activity-fixture";
import { episodicFixtureSchema } from "../../tests/client/episodic/schema-fixture";
import {
	decodeFlatActivity,
	flatProgressEventRow,
	flatReviewEventRow,
} from "../../tests/client/flat-media/activity-fixture";
import { fixtureSchema } from "../../tests/client/flat-media/schema-fixture";
import { mediaActivityExpandLabel, mediaActivityRunLabel } from "./activity-copy";
import { mergeActivityRuns } from "./activity-timeline";
import {
	mediaEpisodicActivityFigures,
	mediaEpisodicActivityRow,
	mediaEpisodicEpisodesAreCollapsed,
	type MediaEpisodicHistoryEvent,
	mediaEpisodicRangeSummary,
	type MediaEpisodicRow,
	type MediaEpisodicWatchedEpisode,
	mergeEpisodicRuns,
} from "./episodic-activity-state";
import { mediaFlatActivityFigures } from "./flat-activity-state";
import type { MediaFlatSchemaActivityView, MediaFlatSchemaRow } from "./flat-schema";

type Item = { readonly key: string; readonly group: string; readonly count: number };

const item = (key: string, group: string): Item => ({ key, group, count: 1 });

const joinSameGroup = (current: Item, next: Item) =>
	current.group === next.group ? { ...current, count: current.count + next.count } : undefined;

describe("merging activity runs", () => {
	it("folds a batch of adjacent rows into the newest row", () => {
		const rows = Array.from({ length: 37 }, (_, index) => item(`episode-${index}`, "catch-up"));

		expect(mergeActivityRuns(rows, joinSameGroup)).toEqual([
			{ count: 37, key: "episode-0", group: "catch-up" },
		]);
	});

	it("leaves rows that are not adjacent to a joinable row untouched", () => {
		const rows = [item("a", "one"), item("b", "two"), item("c", "one")];

		expect(mergeActivityRuns(rows, joinSameGroup)).toEqual(rows);
	});

	it("keeps rows apart when the merge declines them", () => {
		const rows = [item("a", "one"), item("b", "one"), item("c", "two"), item("d", "two")];

		expect(mergeActivityRuns(rows, joinSameGroup)).toEqual([
			{ key: "a", count: 2, group: "one" },
			{ key: "c", count: 2, group: "two" },
		]);
	});

	it("returns nothing for no rows", () => {
		expect(mergeActivityRuns([], joinSameGroup)).toEqual([]);
	});
});

describe("run and expand copy", () => {
	it("states how many updates a run folded and where it started", () => {
		expect(mediaActivityRunLabel({ updates: 12, fromPercent: 3.5 })).toBe("12 updates since 3.5%");
		expect(mediaActivityRunLabel({ updates: 4, fromPercent: undefined })).toBe("4 updates");
	});

	it("labels the control that reveals a long list of episodes", () => {
		expect(mediaActivityExpandLabel({ count: 37, expanded: false })).toBe("Show 37 episodes");
		expect(mediaActivityExpandLabel({ count: 37, expanded: true })).toBe("Hide episodes");
	});
});

type TestEpisode = {
	readonly id: string;
	readonly name: string;
	readonly runtime: number | null;
	readonly season: number;
	readonly number: number;
};

const vocabulary = {
	order: (episode: TestEpisode) => [episode.season, episode.number],
	origin: (episode: TestEpisode) => `S${episode.season} • E${episode.number}`,
};

const watched = (season: number, number: number): MediaEpisodicWatchedEpisode => {
	const episode = { season, number, name: "", runtime: null, id: `s${season}e${number}` };
	return {
		id: episode.id,
		minutes: undefined,
		name: `Episode ${number}`,
		order: vocabulary.order(episode),
		origin: vocabulary.origin(episode),
	};
};

const historyEvent = (input: {
	readonly id: string;
	readonly season: number;
	readonly number: number;
	readonly occurredAt: string;
	readonly consumedOn?: string;
	readonly slug: "complete" | "progress";
	readonly progressPercent?: number;
}): MediaEpisodicHistoryEvent<TestEpisode> => ({
	text: null,
	rating: null,
	properties: {},
	kind: "episode",
	timeSpent: null,
	isSpoiler: null,
	sessionEntityId: null,
	eventSchemaSlug: input.slug,
	createdAt: input.occurredAt,
	occurredAt: input.occurredAt,
	consumedOn: input.consumedOn ?? null,
	id: Schema.decodeSync(EventId)(input.id),
	progressPercent: input.progressPercent ?? null,
	entityId: Schema.decodeSync(EntityId)(`s${input.season}e${input.number}`),
	episode: {
		runtime: null,
		season: input.season,
		number: input.number,
		name: `Episode ${input.number}`,
		id: `s${input.season}e${input.number}`,
	},
});

const historyRows = (events: readonly MediaEpisodicHistoryEvent<TestEpisode>[]) =>
	mergeActivityRuns<MediaEpisodicRow>(
		events.map((event) => mediaEpisodicActivityRow(event, vocabulary)),
		mergeEpisodicRuns,
	);

describe("episodic activity runs", () => {
	it("merges a catch-up batch logged at one instant into one watch row in episode order", () => {
		const rows = historyRows(
			[5, 2, 4, 1, 3].map((number, index) =>
				historyEvent({
					number,
					season: 1,
					slug: "complete",
					consumedOn: "Plex",
					id: `event-${index}`,
					occurredAt: "2026-01-05T10:00:00.000Z",
				}),
			),
		);
		const [row] = rows;

		assert(row?.type === "watch");
		expect(rows).toHaveLength(1);
		expect(row.episodes.map(({ origin }) => origin)).toEqual([
			"S1 • E1",
			"S1 • E2",
			"S1 • E3",
			"S1 • E4",
			"S1 • E5",
		]);
	});

	it("keeps watches apart when their source or instant differs", () => {
		const base = { season: 1, slug: "complete", occurredAt: "2026-01-05T10:00:00.000Z" } as const;
		const rows = historyRows([
			historyEvent({ ...base, id: "a", number: 1, consumedOn: "Plex" }),
			historyEvent({ ...base, id: "b", number: 2, consumedOn: "Jellyfin" }),
			historyEvent({
				...base,
				id: "c",
				number: 3,
				consumedOn: "Jellyfin",
				occurredAt: "2026-01-04T10:00:00.000Z",
			}),
		]);

		expect(rows.map(({ type }) => type)).toEqual(["watch", "watch", "watch"]);
	});

	it("merges adjacent progress on one episode into a run and keeps the newest percent", () => {
		const rows = historyRows(
			[99, 70, 40, 10].map((percent, index) =>
				historyEvent({
					number: 3,
					season: 9,
					id: `p-${index}`,
					slug: "progress",
					progressPercent: percent,
					occurredAt: `2026-01-05T10:0${4 - index}:00.000Z`,
				}),
			),
		);
		const [row] = rows;

		assert(row?.type === "progress");
		expect(rows).toHaveLength(1);
		expect(row.percent).toBe(99);
		expect(row.run).toEqual({ updates: 4, fromPercent: 10 });
	});

	it("does not merge progress on different episodes or progress that is not adjacent", () => {
		const progress = (id: string, number: number, minute: number) =>
			historyEvent({
				id,
				number,
				season: 1,
				slug: "progress",
				progressPercent: 50,
				occurredAt: `2026-01-05T10:0${minute}:00.000Z`,
			});
		const watch = historyEvent({
			season: 1,
			number: 1,
			id: "watch",
			slug: "complete",
			occurredAt: "2026-01-05T10:02:30.000Z",
		});

		expect(historyRows([progress("a", 1, 3), progress("b", 2, 2)])).toHaveLength(2);
		const [later, finished] = historyRows([progress("a", 1, 3), watch, progress("b", 1, 1)]);
		expect(later?.type).toBe("progress");
		assert(finished?.type === "watch");
		expect(finished.run).toEqual({ updates: 1, fromPercent: 50 });
	});

	it("folds the progress run that finished an episode into its watch", () => {
		const progress = (id: string, number: number, minute: number, progressPercent: number) =>
			historyEvent({
				id,
				number,
				season: 1,
				progressPercent,
				slug: "progress",
				occurredAt: `2026-01-05T10:0${minute}:00.000Z`,
			});
		const watch = historyEvent({
			season: 1,
			number: 1,
			id: "watch",
			slug: "complete",
			occurredAt: "2026-01-05T10:05:00.000Z",
		});

		const rows = historyRows([
			watch,
			progress("c", 1, 4, 100),
			progress("b", 1, 3, 40),
			progress("a", 2, 2, 90),
		]);

		expect(rows.map((row) => row.type)).toEqual(["watch", "progress"]);
		assert(rows[0]?.type === "watch");
		expect(rows[0].run).toEqual({ updates: 2, fromPercent: 40 });
	});

	it("sorts the episodes of a watch day by order", () => {
		const day = episodicFixtureSchema.activityView(
			decodeEpisodicActivity({
				parentEvents: [],
				episodeEvents: [],
				episodeProgress: [],
				collectionEvents: [],
				watchDays: [episodicSameDayWatchRow, episodicFirstWatchDayRow],
			}),
		);
		assert(day?.timeline.layout === "flat");
		const [row] = day.timeline.rows;

		assert(row.type === "watch");
		expect(row.episodes.map(({ order }) => order)).toEqual([[1], [2]]);
	});
});

describe("episodic range summary", () => {
	it("joins contiguous stretches of a season and splits at gaps and season changes", () => {
		const episodes = [
			...Array.from({ length: 23 }, (_, index) => watched(3, index + 1)),
			...Array.from({ length: 14 }, (_, index) => watched(4, index + 1)),
		];

		expect(mediaEpisodicRangeSummary(episodes)).toBe("S3 • E1 – S3 • E23, S4 • E1 – S4 • E14");
		expect(mediaEpisodicRangeSummary([watched(1, 1), watched(1, 2), watched(1, 5)])).toBe(
			"S1 • E1 – S1 • E2, S1 • E5",
		);
	});

	it("lists inline up to four episodes and collapses beyond that", () => {
		expect(mediaEpisodicEpisodesAreCollapsed(Array.from({ length: 4 }))).toBe(false);
		expect(mediaEpisodicEpisodesAreCollapsed(Array.from({ length: 5 }))).toBe(true);
	});
});

describe("episodic summary figures", () => {
	const summary = {
		watches: 0,
		minutes: { total: 90, missing: 0 },
		episodes: { total: 4, watched: 2 },
		span: { bound: "partial", latest: "2026-01-05T10:00:00.000Z" },
	} as const;
	const labels = { time: "Time", watches: "Watches", episodes: "Episodes" };

	it("hides the watches figure until a watch is completed", () => {
		expect(mediaEpisodicActivityFigures(summary, labels).map(({ label }) => label)).toEqual([
			"Episodes",
			"Time",
			"Latest",
		]);
		expect(
			mediaEpisodicActivityFigures({ ...summary, watches: 2 }, labels).map(({ label }) => label),
		).toContain("Watches");
	});
});

const viewOf = (input: Parameters<typeof decodeFlatActivity>[0] = {}) => {
	const view = fixtureSchema.activityView(decodeFlatActivity(input));
	assert(view !== undefined, "Expected a ready activity view");
	return view;
};

const rowsOf = (view: MediaFlatSchemaActivityView): readonly MediaFlatSchemaRow[] =>
	view.timeline.layout === "flat" ? view.timeline.rows : [];

const progressAt = (minute: number, percent: number) => ({
	...flatProgressEventRow,
	progressPercent: percent,
	id: `progress-${minute}`,
	occurredAt: `2025-11-03T12:0${minute}:00.000Z`,
});

describe("flat media activity runs and figures", () => {
	it("folds adjacent progress updates into a run anchored on the newest one", () => {
		const rows = rowsOf(
			viewOf({
				collectionEvents: [],
				events: [progressAt(1, 10), progressAt(2, 30), progressAt(3, 98.99)],
			}),
		);
		const [row] = rows;

		assert(row?.type === "progress");
		expect(rows).toHaveLength(1);
		expect(row.percent).toBe(98.99);
		expect(row.run).toEqual({ updates: 3, fromPercent: 10 });
		expect(row.key).toBe("progress-progress-3");
	});

	it("keeps progress apart when another event sits between the updates", () => {
		const rows = rowsOf(
			viewOf({
				collectionEvents: [],
				events: [
					progressAt(1, 10),
					{ ...flatReviewEventRow, occurredAt: "2025-11-03T12:02:00.000Z" },
					progressAt(3, 30),
				],
			}),
		);

		expect(rows.map(({ type }) => type)).toEqual(["progress", "review", "progress"]);
	});

	it("leads with the latest progress and hides an empty amount while nothing is completed", () => {
		const view = viewOf({
			completionCount: 0,
			consumedAmount: null,
			collectionEvents: [],
			events: [progressAt(1, 10), progressAt(2, 42.5)],
		});
		const figures = mediaFlatActivityFigures(view.summary, {
			completions: "Reads",
			measure: { label: "Pages", value: () => "0" },
		});

		expect(figures[0]).toEqual({ value: "42.5%", label: "Progress", detail: undefined });
		expect(figures.map(({ label }) => label)).not.toContain("Pages");
	});

	it("keeps the completions and amount figures once something was completed or consumed", () => {
		const figures = mediaFlatActivityFigures(viewOf().summary, {
			completions: "Reads",
			measure: { label: "Pages", value: ({ total }) => `${total}` },
		});

		expect(figures.slice(0, 2)).toEqual([
			{ value: "1", label: "Reads", detail: undefined },
			{ value: "169", label: "Pages", detail: undefined },
		]);
	});
});
