import { showActivityRecipe } from "@ryot/media-plugin/query-recipes";
import { rowsResult } from "@ryot/ryotql-recipes/test-utils";
import { Result } from "effect";

const showActivityFixtureRecipe = showActivityRecipe({
	seasonLimit: 100,
	entityId: "show-1",
	parentEventLimit: 60,
	episodeEventLimit: 100,
	collectionEventLimit: 60,
	episodeProgressLimit: 100,
});

const emptyEventProperties = {
	text: null,
	rating: null,
	timeSpent: null,
	isSpoiler: null,
	consumedOn: null,
};

const emptyParentProperties = {
	...emptyEventProperties,
	startedOn: null,
	completedOn: null,
};

const firstEpisode = {
	seasonNumber: 1,
	episodeNumber: 1,
	episodeRuntime: 55,
	episodeId: "episode-1",
	episodeName: "Episode 1: The Arrest",
};

const secondEpisode = {
	seasonNumber: 1,
	episodeNumber: 2,
	episodeRuntime: 61,
	episodeId: "episode-2",
	episodeName: "Episode 2: The Interview",
};

const specialEpisode = {
	seasonNumber: 0,
	episodeNumber: 3,
	episodeRuntime: null,
	episodeId: "special-3",
	episodeName: "Making Adolescence",
};

export const showBacklogEventRow = {
	...emptyParentProperties,
	id: "show-backlog",
	eventSchemaSlug: "backlog",
	createdAt: "2025-11-01T12:00:05.000Z",
	occurredAt: "2025-11-01T12:00:00.000Z",
};

export const showCompletionEventRow = {
	...emptyParentProperties,
	timeSpent: 240,
	id: "show-complete",
	eventSchemaSlug: "complete",
	createdAt: "2025-11-06T12:00:05.000Z",
	occurredAt: "2025-11-06T12:00:00.000Z",
};

export const showReviewEventRow = {
	...emptyParentProperties,
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

export const collectionAddedEventRow = {
	id: "watchlist-added",
	collectionName: "Watchlist",
	collectionId: "collection-1",
	createdAt: "2025-11-02T09:00:05.000Z",
	occurredAt: "2025-11-02T09:00:00.000Z",
	eventSchemaSlug: "add-entity-to-collection",
};

export const collectionRemovedEventRow = {
	id: "watchlist-removed",
	collectionName: "Watchlist",
	collectionId: "collection-1",
	createdAt: "2025-11-07T15:00:05.000Z",
	occurredAt: "2025-11-07T15:00:00.000Z",
	eventSchemaSlug: "remove-entity-from-collection",
};

export const specialProgressRow = {
	...specialEpisode,
	consumedOn: "Plex",
	progressPercent: 40,
	id: "special-3-progress",
	createdAt: "2025-11-08T12:00:05.000Z",
	occurredAt: "2025-11-08T12:00:00.000Z",
};

export const showOnHoldEventRow = {
	...emptyParentProperties,
	id: "show-on-hold",
	eventSchemaSlug: "on_hold",
	createdAt: "2025-11-02T12:00:05.000Z",
	occurredAt: "2025-11-02T12:00:00.000Z",
};

export const showDroppedEventRow = {
	...emptyParentProperties,
	id: "show-dropped",
	eventSchemaSlug: "dropped",
	createdAt: "2025-11-03T12:00:05.000Z",
	occurredAt: "2025-11-03T12:00:00.000Z",
};

export const regularSeasonRow = {
	id: "season-1",
	seasonNumber: 1,
	episodeTotal: 4,
	watchedTotal: 2,
	watchedMinutes: 116,
	watchedUnknownRuntime: 0,
};

export const specialsSeasonRow = {
	id: "season-0",
	seasonNumber: 0,
	episodeTotal: 2,
	watchedTotal: 0,
	watchedMinutes: null,
	watchedUnknownRuntime: 0,
};

export const sameDayCompletionEventRow = {
	...emptyEventProperties,
	...secondEpisode,
	consumedOn: "Jellyfin",
	id: "episode-2-same-day",
	eventSchemaSlug: "complete",
	createdAt: "2025-11-04T18:00:05.000Z",
	occurredAt: "2025-11-04T18:00:00.000Z",
};

export const rewatchCompletionEventRow = {
	...emptyParentProperties,
	id: "show-complete-rewatch",
	eventSchemaSlug: "complete",
	createdAt: "2026-03-02T12:00:05.000Z",
	occurredAt: "2026-03-02T12:00:00.000Z",
};

export const rewatchEpisodeEventRow = {
	...emptyEventProperties,
	...firstEpisode,
	consumedOn: "Netflix",
	id: "episode-1-rewatch",
	eventSchemaSlug: "complete",
	createdAt: "2026-03-01T12:00:05.000Z",
	occurredAt: "2026-03-01T12:00:00.000Z",
};

type ActivityRows = {
	readonly truncated?: boolean;
	readonly watchCount?: number;
	readonly seasons?: readonly Record<string, unknown>[];
	readonly parentEvents?: readonly Record<string, unknown>[];
	readonly episodeEvents?: readonly Record<string, unknown>[];
	readonly episodeProgress?: readonly Record<string, unknown>[];
	readonly collectionEvents?: readonly Record<string, unknown>[];
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
				totals: activityRows([{ watchCount: input.watchCount ?? 1 }], false),
				seasons: activityRows(input.seasons ?? [specialsSeasonRow, regularSeasonRow], false),
				parentEvents: activityRows(
					input.parentEvents ?? [showBacklogEventRow, showCompletionEventRow, showReviewEventRow],
					hasMore,
				),
				episodeProgress: progressRows(input.episodeProgress ?? [specialProgressRow]),
				episodeEvents: activityRows(
					input.episodeEvents ?? [
						episodeCompletionEventRow,
						episodeReviewEventRow,
						laterEpisodeCompletionEventRow,
					],
					false,
				),
				collectionEvents: activityRows(
					input.collectionEvents ?? [collectionRemovedEventRow, collectionAddedEventRow],
					false,
				),
			},
		}),
	);
};

export const emptyShowActivity = () =>
	decodeShowActivity({
		parentEvents: [],
		episodeEvents: [],
		episodeProgress: [],
		collectionEvents: [],
	});

export const rewatchedShowActivity = () =>
	decodeShowActivity({
		episodeProgress: [],
		collectionEvents: [],
		parentEvents: [showCompletionEventRow, rewatchCompletionEventRow],
		episodeEvents: [episodeCompletionEventRow, rewatchEpisodeEventRow],
	});
