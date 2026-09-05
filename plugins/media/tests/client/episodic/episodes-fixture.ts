import { Result } from "@ryot-app/client-sdk/effect";
import { createRyotQuery } from "@ryot-app/client-sdk/react";

import type { MediaEpisodePageInput, MediaEpisodeRender } from "../../../client/media/episodes";
import {
	mediaEpisodeNumberLabel,
	type MediaEpisodePage,
} from "../../../client/media/episodes-state";
import { rowsResult } from "../query-result-fixture";
import { episodicFixtureEpisodesRecipe, type EpisodicFixtureEpisode } from "./recipes";

export const EPISODIC_PAGE_LIMIT = 2;

export const episodicEpisodeRow = {
	runtime: 52,
	id: "episode-1",
	episodeNumber: 1,
	state: "untracked",
	publishDate: "2025-03-13",
	populationStatus: "ready",
	translationStatus: "none",
	schemaSlug: "podcast-episode",
	name: "Episode 1: The Arrest",
	description: "A thirteen-year-old is arrested at dawn.",
	images: [{ type: "remote", purpose: "cover", url: "https://images.test/episode-1.jpg" }],
};

export const episodicEpisode = (overrides: Record<string, unknown>) => ({
	...episodicEpisodeRow,
	...overrides,
});

export const episodicEpisodePageData = (input: {
	readonly nextCursor?: string | null;
	readonly episodes?: readonly Record<string, unknown>[];
}) => ({
	data: {
		episodes: rowsResult(input.episodes ?? [episodicEpisodeRow], {
			limit: EPISODIC_PAGE_LIMIT,
			nextCursor: input.nextCursor ?? null,
			hasMore: (input.nextCursor ?? null) !== null,
		}),
	},
});

export const decodeEpisodicEpisodePage = (
	input: {
		readonly nextCursor?: string | null;
		readonly episodes?: readonly Record<string, unknown>[];
	} = {},
) =>
	Result.getOrThrow(
		episodicFixtureEpisodesRecipe({ containerId: "parent-1", limit: EPISODIC_PAGE_LIMIT }).decode(
			episodicEpisodePageData(input),
		),
	);

export const episodicFixtureEpisodesQuery = createRyotQuery<
	MediaEpisodePageInput,
	MediaEpisodePage<EpisodicFixtureEpisode>
>(({ input, client, signal }) =>
	client.data.query(
		episodicFixtureEpisodesRecipe({
			limit: EPISODIC_PAGE_LIMIT,
			containerId: input.containerId,
			...(input.after === null ? {} : { after: input.after }),
		}),
		{ signal },
	),
);

export const EPISODIC_FIXTURE_RENDER: MediaEpisodeRender<EpisodicFixtureEpisode> = {
	aspect: "square",
	purpose: "cover",
	numberLabel: mediaEpisodeNumberLabel,
	originLabel: (episode) => `Ep ${episode.episodeNumber}`,
	stateLabels: { complete: "Played", untracked: undefined, in_progress: "In progress" },
};
