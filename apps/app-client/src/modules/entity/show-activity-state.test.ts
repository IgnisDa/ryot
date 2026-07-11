import { Cause } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";
import { assert, describe, expect, it } from "vitest";

import { RyotQLMalformedResultError } from "@/api/ryotql";

import {
	decodeShowActivity,
	emptyShowActivity,
	episodeCompletionEventRow,
	episodeProgressRow,
	episodeReviewEventRow,
	laterEpisodeCompletionEventRow,
	showBacklogEventRow,
	showCompletionEventRow,
	showReviewEventRow,
	specialProgressRow,
} from "./show-activity-fixture";
import {
	mapShowActivity,
	showActivityError,
	showActivityJournal,
	showActivityLabel,
	showActivityManagedAssets,
	showActivityMetaLabel,
	showActivityMilestones,
	showActivityReviewText,
	showActivityViewingCycles,
} from "./show-activity-state";

const journalOf = (input: Parameters<typeof decodeShowActivity>[0] = {}) =>
	showActivityJournal(decodeShowActivity(input));

const entryLabels = (input: Parameters<typeof decodeShowActivity>[0] = {}) =>
	journalOf(input).cycles.flatMap((cycle) =>
		cycle.days.flatMap((day) => day.entries.map(showActivityLabel)),
	);

const eventById = (id: string) => {
	const event = decodeShowActivity().events.find((candidate) => candidate.id === id);
	assert(event !== undefined);
	return event;
};

const firstEvent = (input: Parameters<typeof decodeShowActivity>[0]) => {
	const event = decodeShowActivity(input).events.at(0);
	assert(event !== undefined);
	return event;
};

describe("show activity state", () => {
	it("maps a pending query to the loading state", () => {
		expect(mapShowActivity(AsyncResult.initial(true))).toEqual({ status: "loading" });
	});

	it("maps a malformed decode failure apart from a transport failure", () => {
		const transport = Cause.fail(new Error("offline"));
		const malformed = Cause.fail(new RyotQLMalformedResultError("bad activity row"));

		expect(mapShowActivity(AsyncResult.failure(malformed)).status).toBe("malformed");
		expect(mapShowActivity(AsyncResult.failure(transport)).status).toBe("transport-error");
	});

	it("keeps error copy free of decoder and transport internals", () => {
		expect(showActivityError({ status: "malformed" }).detail).not.toContain("RyotQL");
		expect(showActivityError({ status: "transport-error" })).toEqual({
			title: "Unable to load activity",
			detail: "Your recorded activity could not be loaded. Check your connection and try again.",
		});
	});

	it("reports a show without recorded activity as empty", () => {
		expect(mapShowActivity(AsyncResult.success(emptyShowActivity()))).toEqual({ status: "empty" });
	});

	it("splits viewing cycles at parent completion boundaries", () => {
		const cycles = showActivityViewingCycles(decodeShowActivity().events);

		expect(cycles.map((cycle) => cycle.completedAt)).toEqual([null, "2025-11-06T12:00:00.000Z"]);
		expect(cycles.at(0)?.events.map((event) => event.id)).toEqual([
			"special-3-progress",
			"show-review",
		]);
		expect(cycles.at(1)?.events.map((event) => event.id)).toEqual([
			"show-complete",
			"episode-2-complete",
			"episode-1-review",
			"episode-1-complete",
			"episode-1-progress",
			"show-backlog",
		]);
	});

	it("heads completed cycles with their completion date and the rest as the current watch", () => {
		expect(journalOf().cycles.map((cycle) => cycle.heading)).toEqual([
			"Current watch",
			"Completed Nov 6, 2025",
		]);
	});

	it("leaves a never-completed show as one unlabelled chronological journal", () => {
		const journal = journalOf({ parentEvents: [showBacklogEventRow] });

		expect(journal.cycles).toHaveLength(1);
		expect(journal.cycles.at(0)?.heading).toBeUndefined();
	});

	it("collapses progress that a completion in the same cycle already supersedes", () => {
		expect(entryLabels()).toEqual([
			"Reached 40% in Making Adolescence",
			"Rated 82/100",
			"Completed the show",
			"Watched Episode 2: The Interview",
			"Rated 90/100",
			"Watched Episode 1: The Arrest",
			"Added to backlog",
		]);
	});

	it("keeps progress recorded after the completion of the same episode", () => {
		const rewatch = { ...episodeProgressRow, occurredAt: "2025-11-04T18:00:00.000Z" };

		expect(entryLabels({ episodeProgress: [rewatch] })).toContain(
			"Reached 90% in Episode 1: The Arrest",
		);
	});

	it("keeps only the newest progress milestone for an unfinished episode", () => {
		const older = { ...episodeProgressRow, id: "older", occurredAt: "2025-11-02T12:00:00.000Z" };
		const collapsed = showActivityMilestones(
			decodeShowActivity({ episodeEvents: [], episodeProgress: [episodeProgressRow, older] })
				.events,
		);

		expect(collapsed.map((event) => event.id)).toEqual([
			"show-review",
			"show-complete",
			"episode-1-progress",
			"show-backlog",
		]);
	});

	it("groups a cycle into descending day groups", () => {
		const completed = journalOf().cycles.at(1);

		expect(completed?.days.map((day) => day.label)).toEqual([
			"Nov 6, 2025",
			"Nov 5, 2025",
			"Nov 4, 2025",
			"Nov 1, 2025",
		]);
		expect(completed?.days.at(1)?.entries.map((event) => event.id)).toEqual([
			"episode-2-complete",
			"episode-1-review",
		]);
	});

	it("summarises history from the tracked span, completed watches and sources", () => {
		expect(journalOf().facts).toEqual([
			{ label: "Tracked", value: "Nov 1 – Nov 8, 2025" },
			{ label: "Completed watches", value: "1" },
			{ label: "Watched on", value: "Plex, Jellyfin" },
		]);
	});

	it("spans a tracked history that crosses calendar years", () => {
		expect(
			journalOf({
				parentEvents: [
					{ ...showBacklogEventRow, occurredAt: "2024-11-01T12:00:00.000Z" },
					showCompletionEventRow,
					showReviewEventRow,
				],
			}).facts.at(0),
		).toEqual({ label: "Tracked", value: "Nov 1, 2024 – Nov 8, 2025" });
	});

	it("omits history facts that bounded activity cannot establish", () => {
		const journal = journalOf({ truncated: true });

		expect(journal.truncated).toBe(true);
		expect(journal.facts).toEqual([
			{ label: "Latest activity", value: "Nov 8, 2025" },
			{ label: "Watched on", value: "Plex, Jellyfin" },
		]);
	});

	it("labels every recorded parent lifecycle event in plain language", () => {
		const parentEvent = (overrides: Record<string, unknown>) =>
			showActivityLabel(
				firstEvent({
					episodeEvents: [],
					episodeProgress: [],
					parentEvents: [{ ...showBacklogEventRow, ...overrides }],
				}),
			);

		expect(parentEvent({ eventSchemaSlug: "backlog" })).toBe("Added to backlog");
		expect(parentEvent({ eventSchemaSlug: "on_hold" })).toBe("Put this show on hold");
		expect(parentEvent({ eventSchemaSlug: "dropped" })).toBe("Stopped watching");
		expect(parentEvent({ eventSchemaSlug: "complete" })).toBe("Completed the show");
		expect(parentEvent({ eventSchemaSlug: "review" })).toBe("Wrote a review");
		expect(parentEvent({ eventSchemaSlug: "review", rating: 82.5 })).toBe("Rated 82.5/100");
	});

	it("shows the consumption source and recorded time only when they exist", () => {
		expect(showActivityMetaLabel(eventById("episode-1-complete"))).toBe(
			"S1 • E1 • Watched on Jellyfin • 1h 6m recorded time",
		);
		expect(showActivityMetaLabel(eventById("show-complete"))).toBe("4h recorded time");
		expect(showActivityMetaLabel(eventById("show-backlog"))).toBe("");
	});

	it("places special episodes in history under their specials origin", () => {
		expect(showActivityMetaLabel(eventById("special-3-progress"))).toBe(
			"Specials • E3 • Watched on Plex",
		);
	});

	it("names the reviewed episode in an episode review", () => {
		expect(showActivityMetaLabel(eventById("episode-1-review"))).toBe(
			"S1 • E1 • Episode 1: The Arrest",
		);
	});

	it("exposes review bodies only for review events", () => {
		expect(showActivityReviewText(eventById("show-review"))).toBe("A devastating watch.");
		expect(showActivityReviewText(eventById("episode-1-review"))).toBe(
			"The arrest scene is the whole show.",
		);
		expect(showActivityReviewText(eventById("episode-1-complete"))).toBeUndefined();
	});

	it("names a progress milestone without a recorded percentage", () => {
		const label = showActivityLabel(
			firstEvent({
				parentEvents: [],
				episodeEvents: [],
				episodeProgress: [{ ...specialProgressRow, progressPercent: null }],
			}),
		);

		expect(label).toBe("Made progress in Making Adolescence");
	});

	it("collects managed episode stills without remote locators", () => {
		expect(showActivityManagedAssets(journalOf())).toEqual([]);
		expect(
			showActivityManagedAssets(
				journalOf({
					episodeProgress: [],
					parentEvents: [showCompletionEventRow, showReviewEventRow],
					episodeEvents: [
						{
							...episodeCompletionEventRow,
							episodeImages: [{ type: "s3", key: "episode-1", purpose: "still" }],
						},
						episodeReviewEventRow,
						laterEpisodeCompletionEventRow,
					],
				}),
			),
		).toEqual([{ type: "s3", key: "episode-1" }]);
	});
});
