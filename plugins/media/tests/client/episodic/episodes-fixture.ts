import { Result } from "@ryot-app/plugin-client-sdk/effect";
import { createRyotQuery } from "@ryot-app/plugin-client-sdk/react";
import { bindRecipe } from "@ryot-app/ryotql-recipes/test-utils";

import type { MediaActivityLogger } from "../../../client/media/activity-log/state";
import type { MediaCursorPage } from "../../../client/media/cursor-page-state";
import { createMediaEpisodeCredits } from "../../../client/media/episode-credits";
import type {
	MediaEpisodeLog,
	MediaEpisodePageInput,
	MediaEpisodeRender,
} from "../../../client/media/episodes";
import { mediaEpisodeNumberLabel } from "../../../client/media/episodes-state";
import {
	creditCharacterSelection,
	mediaEpisodeCreditsRecipe,
	mediaPeopleRecipe,
} from "../../../shared/media-recipes";
import { rowsResult } from "../query-result-fixture";
import { type EpisodicFixtureEpisode, episodicFixtureEpisodesRecipe } from "./recipes";

export const EPISODIC_PAGE_LIMIT = 2;

export const episodicEpisodeRow = {
	runtime: 52,
	id: "episode-1",
	episodeNumber: 1,
	state: "untracked",
	publishDate: "2025-03-13",
	schemaSlug: "podcast-episode",
	name: "Episode 1: The Arrest",
	description: "A thirteen-year-old is arrested at dawn.",
	translationStatus: { state: "idle", availability: "none" },
	populationStatus: { state: "succeeded", availability: "complete" },
	relatedPopulationStatus: { state: "succeeded", availability: "complete" },
	images: [{ type: "remote", purpose: "cover", url: "https://images.test/episode-1.jpg" }],
};

export const episodicEpisode = (overrides: Record<string, unknown>) => ({
	...episodicEpisodeRow,
	...overrides,
});

export const episodicEpisodePageData = (input: {
	readonly nextCursor?: null | string;
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
		readonly nextCursor?: null | string;
		readonly episodes?: readonly Record<string, unknown>[];
	} = {},
) =>
	Result.getOrThrow(
		bindRecipe(episodicFixtureEpisodesRecipe({ reference: { kind: "self" } }), {
			containerId: "parent-1",
			limit: EPISODIC_PAGE_LIMIT,
		}).decode(episodicEpisodePageData(input)),
	);

export const episodicFixtureEpisodesQuery = createRyotQuery<
	MediaEpisodePageInput,
	MediaCursorPage<EpisodicFixtureEpisode>
>(({ input, client }) =>
	client.data.query(
		episodicFixtureEpisodesRecipe({ reference: { kind: "self" } }),
		{ containerId: input.containerId },
		{ pages: { episodes: { limit: EPISODIC_PAGE_LIMIT, after: input.after ?? undefined } } },
	),
);

export const EPISODIC_FIXTURE_RENDER: MediaEpisodeRender<EpisodicFixtureEpisode> = {
	aspect: "square",
	purpose: "cover",
	entitySchemaSlug: "podcast-episode",
	numberLabel: mediaEpisodeNumberLabel,
	originLabel: (episode) => `Ep ${episode.episodeNumber}`,
	stateLabels: { complete: "Played", untracked: undefined, in_progress: "In progress" },
	activityEpisode: (episode) => ({
		id: episode.id,
		seasonNumber: null,
		name: episode.name,
		state: episode.state,
		episodeNumber: episode.episodeNumber,
	}),
};

const EPISODIC_FIXTURE_LOGGER: MediaActivityLogger = {
	family: "podcast",
	copy: { noun: "podcast", verb: "listen to", gerund: "listening", participle: "listened" },
};

export const EPISODIC_FIXTURE_LOG: MediaEpisodeLog = {
	parentEntityId: "parent-1",
	logger: EPISODIC_FIXTURE_LOGGER,
};

export const EPISODIC_FIXTURE_CREDITS = createMediaEpisodeCredits({
	copy: {
		crew: "Crew",
		title: "Cast & crew",
		guestStars: "Guest stars",
		fullCredits: "Full cast & crew",
		loading: "Fetching this episode's cast and crew.",
	},
	recipes: {
		overviewRecipe: mediaEpisodeCreditsRecipe({ slug: "podcast-episode" }),
		peopleRecipe: mediaPeopleRecipe({
			slug: "podcast-episode",
			personFields: creditCharacterSelection,
		}),
	},
});

export const episodicCreditRow = (overrides: Record<string, unknown>) => ({
	order: 0,
	images: [],
	isGuest: null,
	character: null,
	creditKinds: null,
	departments: null,
	isUncredited: null,
	isInMediaLibrary: false,
	translationStatus: { state: "idle", availability: "none" },
	populationStatus: { state: "succeeded", availability: "complete" },
	relatedPopulationStatus: { state: "idle", availability: "missing" },
	...overrides,
});

const creditRows = (items: readonly Record<string, unknown>[]) =>
	rowsResult(items, { limit: 12, hasMore: false, nextCursor: null });

export const episodicCreditsData = (input: {
	readonly crew: readonly Record<string, unknown>[];
	readonly guestStars: readonly Record<string, unknown>[];
}) => ({ data: { crew: creditRows(input.crew), guestStars: creditRows(input.guestStars) } });
