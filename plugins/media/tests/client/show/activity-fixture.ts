import { Result } from "@ryot-app/client-sdk/effect";

import { showRecipes } from "../../../shared/show-recipes";
import { rowsResult } from "../query-result-fixture";

const showActivityFixtureRecipe = showRecipes.activityRecipe({
	timeZone: "UTC",
	coverageLimit: 100,
	entityId: "show-1",
	watchDayLimit: 1000,
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

const emptyParentProperties = { ...emptyEventProperties, startedOn: null, completedOn: null };

const firstEpisode = {
	seasonNumber: 1,
	episodeNumber: 1,
	episodeRuntime: 55,
	episodeId: "episode-1",
	episodeName: "Episode 1: The Arrest",
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

export const firstWatchDayRow = {
	minutes: 66,
	runtime: 55,
	seasonNumber: 1,
	episodeNumber: 1,
	episodeId: "episode-1",
	consumedOn: "Jellyfin",
	day: "2025-11-04T00:00:00.000Z",
	episodeName: "Episode 1: The Arrest",
};

export const secondWatchDayRow = {
	runtime: 61,
	minutes: null,
	seasonNumber: 1,
	episodeNumber: 2,
	episodeId: "episode-2",
	consumedOn: "Jellyfin",
	day: "2025-11-05T00:00:00.000Z",
	episodeName: "Episode 2: The Interview",
};

export const sameDayWatchRow = { ...secondWatchDayRow, day: firstWatchDayRow.day };

export const rewatchWatchDayRow = {
	...firstWatchDayRow,
	minutes: null,
	consumedOn: "Netflix",
	day: "2026-03-01T00:00:00.000Z",
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

export const rewatchCompletionEventRow = {
	...emptyParentProperties,
	id: "show-complete-rewatch",
	eventSchemaSlug: "complete",
	createdAt: "2026-03-02T12:00:05.000Z",
	occurredAt: "2026-03-02T12:00:00.000Z",
};

type ActivityRows = {
	readonly truncated?: boolean;
	readonly watchCount?: number;
	readonly coverage?: readonly Record<string, unknown>[];
	readonly watchDays?: readonly Record<string, unknown>[];
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
				pageInfo: { limit: 1, hasMore: false },
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
				episodeProgress: progressRows(input.episodeProgress ?? [specialProgressRow]),
				episodeEvents: activityRows(input.episodeEvents ?? [episodeReviewEventRow], false),
				coverage: activityRows(input.coverage ?? [specialsSeasonRow, regularSeasonRow], false),
				collectionEvents: activityRows(
					input.collectionEvents ?? [collectionRemovedEventRow, collectionAddedEventRow],
					false,
				),
				parentEvents: activityRows(
					input.parentEvents ?? [showBacklogEventRow, showCompletionEventRow, showReviewEventRow],
					hasMore,
				),
				watchDays: {
					type: "aggregate",
					pageInfo: { limit: 1000, hasMore: hasMore },
					items: input.watchDays ?? [firstWatchDayRow, secondWatchDayRow],
				},
			},
		}),
	);
};

export const emptyShowActivity = () =>
	decodeShowActivity({
		watchDays: [],
		watchCount: 0,
		parentEvents: [],
		episodeEvents: [],
		episodeProgress: [],
		collectionEvents: [],
	});

export const rewatchedShowActivity = () =>
	decodeShowActivity({
		watchCount: 2,
		episodeEvents: [],
		episodeProgress: [],
		collectionEvents: [],
		watchDays: [rewatchWatchDayRow, firstWatchDayRow],
		parentEvents: [showCompletionEventRow, rewatchCompletionEventRow],
	});
