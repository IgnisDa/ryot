import { assert, describe, expect, it } from "vitest";

import {
	decodeEpisodicEpisodePage,
	episodicEpisode,
	episodicEpisodeRow,
} from "../../tests/client/episodic/episodes-fixture";
import type { EpisodicFixtureEpisode } from "../../tests/client/episodic/recipes";
import {
	malformedQueryResult,
	pendingQueryResult,
	readyQueryResult,
	transportErrorQueryResult,
} from "../../tests/client/query-result-fixture";
import {
	mapMediaEpisodePage,
	mediaEpisodeAirDateLabel,
	mediaEpisodeNumberLabel,
	mediaEpisodePageError,
	mediaEpisodeRuntimeLabel,
	mediaEpisodeStateLabel,
	mediaEpisodeSynopsis,
	mediaEpisodesManagedAssets,
	mediaNextUpEpisode,
	type MediaEpisodePage,
} from "./episodes-state";

type EpisodicPage = MediaEpisodePage<EpisodicFixtureEpisode>;

const STATE_LABELS = { complete: "Played", untracked: undefined, in_progress: "In progress" };

const readyEpisodes = (episodes: readonly Record<string, unknown>[]) => {
	const state = mapMediaEpisodePage(readyQueryResult(decodeEpisodicEpisodePage({ episodes })));
	assert(state.status === "ready");
	return state.episodes;
};

describe("media episode page state", () => {
	it("maps a pending query to the loading state", () => {
		expect(mapMediaEpisodePage(pendingQueryResult<EpisodicPage>())).toEqual({ status: "loading" });
	});

	it("maps a malformed decode failure apart from a transport failure", () => {
		expect(mapMediaEpisodePage(malformedQueryResult<EpisodicPage>()).status).toBe("malformed");
		expect(mapMediaEpisodePage(transportErrorQueryResult<EpisodicPage>()).status).toBe(
			"transport-error",
		);
	});

	it("carries the cursor a page hands back so the next page can resume", () => {
		expect(
			mapMediaEpisodePage(readyQueryResult(decodeEpisodicEpisodePage({ nextCursor: "cursor-2" }))),
		).toMatchObject({ status: "ready", nextCursor: "cursor-2", episodes: [{ id: "episode-1" }] });
		expect(mapMediaEpisodePage(readyQueryResult(decodeEpisodicEpisodePage()))).toMatchObject({
			status: "ready",
			nextCursor: null,
		});
	});

	it("keeps error copy free of decoder and transport internals", () => {
		expect(
			mediaEpisodePageError({ noun: "episodes", state: { status: "malformed" } }).detail,
		).not.toContain("RyotQL");
		expect(
			mediaEpisodePageError({ noun: "episodes", state: { status: "transport-error" } }),
		).toEqual({
			title: "Unable to load these episodes",
			detail: "These episodes could not be loaded. Check your connection and try again.",
		});
	});

	it("resumes a forward sequence at the first untracked episode after the last completed one", () => {
		const nextUp = mediaNextUpEpisode(
			readyEpisodes([
				episodicEpisode({ id: "episode-1", episodeNumber: 1, state: "complete" }),
				episodicEpisode({ id: "episode-2", episodeNumber: 2, state: "untracked" }),
			]),
			"forward",
		);

		expect(nextUp?.id).toBe("episode-2");
	});

	it("has no forward next up until something has been completed", () => {
		expect(
			mediaNextUpEpisode(readyEpisodes([episodicEpisode({ state: "untracked" })]), "forward"),
		).toBeUndefined();
		expect(
			mediaNextUpEpisode(readyEpisodes([episodicEpisode({ state: "complete" })]), "forward"),
		).toBeUndefined();
	});

	it("opens a newest-first list at the newest episode with no completion", () => {
		const episodes = readyEpisodes([
			episodicEpisode({ id: "episode-9", episodeNumber: 9, state: "untracked" }),
			episodicEpisode({ id: "episode-8", episodeNumber: 8, state: "complete" }),
		]);

		expect(mediaNextUpEpisode(episodes, "latest")?.id).toBe("episode-9");
		expect(mediaNextUpEpisode(episodes, "forward")).toBeUndefined();
	});

	it("prefers an in-progress episode in either direction", () => {
		const episodes = readyEpisodes([
			episodicEpisode({ id: "episode-9", episodeNumber: 9, state: "untracked" }),
			episodicEpisode({ id: "episode-8", episodeNumber: 8, state: "in_progress" }),
			episodicEpisode({ id: "episode-7", episodeNumber: 7, state: "complete" }),
		]);

		expect(mediaNextUpEpisode(episodes, "latest")?.id).toBe("episode-8");
		expect(mediaNextUpEpisode(episodes, "forward")?.id).toBe("episode-8");
	});

	it("formats the metadata a provider recorded and omits the rest", () => {
		const [first, second] = readyEpisodes([
			episodicEpisodeRow,
			episodicEpisode({ runtime: null, id: "episode-2", publishDate: null, description: "  " }),
		]);
		assert(first !== undefined && second !== undefined);

		expect(mediaEpisodeNumberLabel(first)).toBe("E1");
		expect(mediaEpisodeAirDateLabel(first)).toBe("Mar 13, 2025");
		expect(mediaEpisodeRuntimeLabel(first)).toBe("52 min");
		expect(mediaEpisodeSynopsis(first)).toBe("A thirteen-year-old is arrested at dawn.");
		expect(mediaEpisodeAirDateLabel(second)).toBeUndefined();
		expect(mediaEpisodeRuntimeLabel(second)).toBeUndefined();
		expect(mediaEpisodeSynopsis(second)).toBeUndefined();
	});

	it("keeps the lifecycle indicator quiet for untracked episodes", () => {
		expect(mediaEpisodeStateLabel("untracked", STATE_LABELS)).toBeUndefined();
		expect(mediaEpisodeStateLabel("in_progress", STATE_LABELS)).toBe("In progress");
		expect(mediaEpisodeStateLabel("complete", STATE_LABELS)).toBe("Played");
	});

	it("collects only the managed locators the episode artwork needs", () => {
		const episodes = readyEpisodes([
			episodicEpisode({ images: [{ type: "local", purpose: "cover", key: "episode-cover" }] }),
			episodicEpisode({ images: null, id: "episode-2" }),
		]);

		expect(mediaEpisodesManagedAssets(episodes, "cover")).toEqual([
			{ type: "local", key: "episode-cover" },
		]);
	});
});
