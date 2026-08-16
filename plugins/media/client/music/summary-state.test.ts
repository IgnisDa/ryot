import { describe, expect, it } from "vitest";

import {
	decodeMusicSummary,
	decodeMusicSummaryResult,
	musicSummaryRow,
} from "../../tests/client/music/summary-fixture";
import {
	malformedQueryResult,
	pendingQueryResult,
	readyQueryResult,
	transportErrorQueryResult,
} from "../../tests/client/query-result-fixture";
import {
	mapMusicSummary,
	musicDurationFact,
	musicLifecycleLabel,
	musicSummaryError,
	musicSummaryFacts,
	musicSummaryProgress,
	musicSummaryUnavailable,
} from "./summary-state";

describe("music summary state", () => {
	it("maps a pending query to the loading state", () => {
		expect(mapMusicSummary(pendingQueryResult())).toEqual({ status: "loading" });
	});

	it("maps a malformed decode failure apart from a transport failure", () => {
		expect(mapMusicSummary(malformedQueryResult()).status).toBe("malformed");
		expect(mapMusicSummary(transportErrorQueryResult()).status).toBe("transport-error");
	});

	it("separates an absent entity from one of another schema", () => {
		expect(
			mapMusicSummary(readyQueryResult(decodeMusicSummaryResult({ music: [], requested: [] }))),
		).toEqual({ reason: "missing", status: "unavailable" });
		expect(
			mapMusicSummary(
				readyQueryResult(
					decodeMusicSummaryResult({ music: [], requested: [{ schemaSlug: "movie" }] }),
				),
			),
		).toEqual({ reason: "unsupported", status: "unavailable" });
		expect(musicSummaryUnavailable("unsupported").detail).toBe(
			"This entity is not a track, and only tracks can be opened here.",
		);
		expect(musicSummaryUnavailable("missing").title).toBe("Music unavailable");
	});

	it("maps a decoded track to the ready state", () => {
		expect(
			mapMusicSummary(
				readyQueryResult(
					decodeMusicSummaryResult({
						music: [musicSummaryRow],
						requested: [{ schemaSlug: "music" }],
					}),
				),
			),
		).toMatchObject({ status: "ready", summary: { id: "music-1", name: "Paranoid Android" } });
	});

	it("keeps error copy free of decoder and transport internals", () => {
		expect(musicSummaryError({ status: "malformed" })).toEqual({
			title: "Unable to display this track",
			detail: "This track returned data that could not be displayed. Try again later.",
		});
		expect(musicSummaryError({ status: "transport-error" }).detail).not.toContain("RyotQL");
	});

	it("labels every flat lifecycle state and never a caught up one", () => {
		expect(musicLifecycleLabel("untracked")).toBe("Not tracked");
		expect(musicLifecycleLabel("backlog")).toBe("In backlog");
		expect(musicLifecycleLabel("in_progress")).toBe("In progress");
		expect(musicLifecycleLabel("on_hold")).toBe("On hold");
		expect(musicLifecycleLabel("dropped")).toBe("Dropped");
		expect(musicLifecycleLabel("complete")).toBe("Complete");
	});

	it("reads the duration fact as a track length and omits it when unrecorded", () => {
		expect(musicDurationFact(decodeMusicSummary())).toEqual({
			icon: "clock",
			value: "3:42",
			label: "Length",
		});
		expect(musicDurationFact(decodeMusicSummary({ duration: null }))).toBeUndefined();
	});

	it("lists only the facts the music schema declares", () => {
		expect(musicSummaryFacts(decodeMusicSummary()).map(({ label }) => label)).toEqual([
			"MusicBrainz rating",
			"Length",
			"Various artists",
			"Production status",
		]);
		expect(musicSummaryFacts(decodeMusicSummary()).map(({ label }) => label)).not.toContain(
			"Runtime",
		);
	});

	it("drops the facts the provider never recorded", () => {
		expect(
			musicSummaryFacts(
				decodeMusicSummary({
					duration: null,
					providerRating: null,
					productionStatus: null,
					byVariousArtists: null,
				}),
			),
		).toEqual([]);
	});

	it("shows the status rail progress bar only while the track is in progress", () => {
		expect(
			musicSummaryProgress(decodeMusicSummary({ progressPercent: 40, state: "in_progress" })),
		).toEqual({ percent: 40 });
		expect(
			musicSummaryProgress(decodeMusicSummary({ state: "complete", progressPercent: 40 })),
		).toBeUndefined();
		expect(
			musicSummaryProgress(decodeMusicSummary({ state: "in_progress", progressPercent: null })),
		).toBeUndefined();
	});
});
