import { assert, describe, expect, it } from "vitest";

import {
	decodeEpisodicEpisodePage,
	episodicEpisode,
	episodicEpisodeRow,
} from "../../tests/client/episodic/episodes-fixture";
import { readyQueryResult } from "../../tests/client/query-result-fixture";
import { mapMediaCursorPage } from "./cursor-page-state";
import {
	mediaEpisodeAirDateLabel,
	mediaEpisodeNumberLabel,
	mediaEpisodeRuntimeLabel,
	mediaEpisodeStateLabel,
	mediaEpisodeSynopsis,
	mediaEpisodesManagedAssets,
} from "./episodes-state";

const STATE_LABELS = { complete: "Played", untracked: undefined, in_progress: "In progress" };

const readyEpisodes = (episodes: readonly Record<string, unknown>[]) => {
	const state = mapMediaCursorPage(readyQueryResult(decodeEpisodicEpisodePage({ episodes })));
	assert(state.status === "ready");
	return state.items;
};

describe("media episode state", () => {
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
