import { showActivityRecipe } from "@ryot/media-plugin/query-recipes";
import { rowsResult } from "@ryot/ryotql-recipes/test-utils";
import { Result } from "effect";

const showActivityFixtureRecipe = showActivityRecipe({
	entityId: "show-1",
	parentEventLimit: 60,
	episodeEventLimit: 100,
	episodeProgressLimit: 100,
});

const emptyEventProperties = {
	text: null,
	rating: null,
	timeSpent: null,
	isSpoiler: null,
	consumedOn: null,
};

const firstEpisode = {
	seasonNumber: 1,
	episodeNumber: 1,
	episodeId: "episode-1",
	episodeName: "Episode 1: The Arrest",
	episodeImages: [{ type: "remote", url: "https://images.test/episode-1.jpg", purpose: "still" }],
};

const secondEpisode = {
	seasonNumber: 1,
	episodeNumber: 2,
	episodeImages: null,
	episodeId: "episode-2",
	episodeName: "Episode 2: The Interview",
};

const specialEpisode = {
	seasonNumber: 0,
	episodeNumber: 3,
	episodeImages: null,
	episodeId: "special-3",
	episodeName: "Making Adolescence",
};

export const showBacklogEventRow = {
	...emptyEventProperties,
	id: "show-backlog",
	eventSchemaSlug: "backlog",
	createdAt: "2025-11-01T12:00:05.000Z",
	occurredAt: "2025-11-01T12:00:00.000Z",
};

export const showCompletionEventRow = {
	...emptyEventProperties,
	timeSpent: 240,
	id: "show-complete",
	eventSchemaSlug: "complete",
	createdAt: "2025-11-06T12:00:05.000Z",
	occurredAt: "2025-11-06T12:00:00.000Z",
};

export const showReviewEventRow = {
	...emptyEventProperties,
	rating: 82,
	isSpoiler: false,
	id: "show-review",
	eventSchemaSlug: "review",
	text: "A devastating watch.",
	createdAt: "2025-11-07T12:00:05.000Z",
	occurredAt: "2025-11-07T12:00:00.000Z",
};

export const episodeCompletionEventRow = {
	...emptyEventProperties,
	...firstEpisode,
	timeSpent: 66,
	consumedOn: "Jellyfin",
	id: "episode-1-complete",
	eventSchemaSlug: "complete",
	createdAt: "2025-11-04T12:00:05.000Z",
	occurredAt: "2025-11-04T12:00:00.000Z",
};

export const episodeReviewEventRow = {
	...emptyEventProperties,
	...firstEpisode,
	rating: 90,
	isSpoiler: true,
	id: "episode-1-review",
	eventSchemaSlug: "review",
	createdAt: "2025-11-05T10:00:05.000Z",
	occurredAt: "2025-11-05T10:00:00.000Z",
	text: "The arrest scene is the whole show.",
};

export const laterEpisodeCompletionEventRow = {
	...emptyEventProperties,
	...secondEpisode,
	consumedOn: "Jellyfin",
	id: "episode-2-complete",
	eventSchemaSlug: "complete",
	createdAt: "2025-11-05T14:00:05.000Z",
	occurredAt: "2025-11-05T14:00:00.000Z",
};

export const episodeProgressRow = {
	...firstEpisode,
	consumedOn: null,
	progressPercent: 90,
	id: "episode-1-progress",
	createdAt: "2025-11-03T12:00:05.000Z",
	occurredAt: "2025-11-03T12:00:00.000Z",
};

export const specialProgressRow = {
	...specialEpisode,
	consumedOn: "Plex",
	progressPercent: 40,
	id: "special-3-progress",
	createdAt: "2025-11-08T12:00:05.000Z",
	occurredAt: "2025-11-08T12:00:00.000Z",
};

type ActivityRows = {
	readonly truncated?: boolean;
	readonly parentEvents?: readonly Record<string, unknown>[];
	readonly episodeEvents?: readonly Record<string, unknown>[];
	readonly episodeProgress?: readonly Record<string, unknown>[];
};

const activityRows = (items: readonly Record<string, unknown>[], hasMore: boolean) =>
	rowsResult(items, { hasMore, limit: 100, nextCursor: hasMore ? "activity-cursor" : null });

const progressRows = (items: readonly Record<string, unknown>[]) =>
	activityRows(
		items.map(({ id, createdAt, occurredAt, consumedOn, progressPercent, ...episode }) => ({
			...episode,
			milestone: {
				pageInfo: { hasMore: false, limit: 1 },
				items: [{ id, createdAt, occurredAt, consumedOn, progressPercent }],
			},
		})),
		false,
	);

export const decodeShowActivity = (input: ActivityRows = {}) => {
	const hasMore = input.truncated === true;
	return Result.getOrThrow(
		showActivityFixtureRecipe.decode({
			data: {
				parentEvents: activityRows(
					input.parentEvents ?? [showBacklogEventRow, showCompletionEventRow, showReviewEventRow],
					hasMore,
				),
				episodeProgress: progressRows(
					input.episodeProgress ?? [episodeProgressRow, specialProgressRow],
				),
				episodeEvents: activityRows(
					input.episodeEvents ?? [
						episodeCompletionEventRow,
						episodeReviewEventRow,
						laterEpisodeCompletionEventRow,
					],
					false,
				),
			},
		}),
	);
};

export const emptyShowActivity = () =>
	decodeShowActivity({ parentEvents: [], episodeEvents: [], episodeProgress: [] });
