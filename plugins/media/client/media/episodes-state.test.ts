import { describe, expect, it } from "bun:test";

import { testFormatters } from "@ryot-app/kernel-messages/testing";
import { assert } from "@ryot-app/testing/assert";

import { catalogMessage } from "../../shared/messages.generated";
import {
	decodeEpisodicEpisodePage,
	episodicEpisode,
	episodicEpisodeRow,
} from "../../tests/client/episodic/episodes-fixture";
import { testMediaText } from "../../tests/client/test-text";
import {
	mediaEpisodeAirDateLabel,
	mediaEpisodeNumberLabel,
	mediaEpisodeRuntimeLabel,
	mediaEpisodesManagedAssets,
	mediaEpisodeStateLabel,
	mediaEpisodeSynopsis,
} from "./episodes-state";

const STATE_LABELS = {
	untracked: undefined,
	complete: catalogMessage("episodes.state-played"),
	in_progress: catalogMessage("browse.status.in-progress"),
};

const readyEpisodes = (episodes: readonly Record<string, unknown>[]) =>
	decodeEpisodicEpisodePage({ episodes }).items;

describe("media episode state", () => {
	it("formats the metadata a provider recorded and omits the rest", () => {
		const [first, second] = readyEpisodes([
			episodicEpisodeRow,
			episodicEpisode({ runtime: null, id: "episode-2", publishDate: null, description: "  " }),
		]);
		assert(first !== undefined && second !== undefined);

		expect(mediaEpisodeNumberLabel(first)).toEqual(
			catalogMessage("episode.number", { episode: 1 }),
		);
		expect(mediaEpisodeAirDateLabel(testFormatters, first)).toBe("Mar 13, 2025");
		expect<string | undefined>(mediaEpisodeRuntimeLabel(testMediaText, first)).toBe("52 min");
		expect(mediaEpisodeSynopsis(first)).toBe("A thirteen-year-old is arrested at dawn.");
		expect(mediaEpisodeAirDateLabel(testFormatters, second)).toBeUndefined();
		expect(mediaEpisodeRuntimeLabel(testMediaText, second)).toBeUndefined();
		expect(mediaEpisodeSynopsis(second)).toBeUndefined();
	});

	it("keeps the lifecycle indicator quiet for untracked episodes", () => {
		expect(mediaEpisodeStateLabel("untracked", STATE_LABELS)).toBeUndefined();
		expect(mediaEpisodeStateLabel("in_progress", STATE_LABELS)).toEqual(
			catalogMessage("browse.status.in-progress"),
		);
		expect(mediaEpisodeStateLabel("complete", STATE_LABELS)).toEqual(
			catalogMessage("episodes.state-played"),
		);
	});

	it("collects only the managed locators the episode artwork needs", () => {
		const episodes = readyEpisodes([
			episodicEpisode({ image: { type: "local", key: "episode-cover" } }),
			episodicEpisode({ image: null, id: "episode-2" }),
		]);

		expect(mediaEpisodesManagedAssets(episodes)).toEqual([{ type: "local", key: "episode-cover" }]);
	});
});
