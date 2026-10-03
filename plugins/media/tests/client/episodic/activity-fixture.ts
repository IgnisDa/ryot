import { Result } from "@ryot-app/client-sdk/effect";

import { rowsResult } from "../query-result-fixture";
import { episodicFixtureRecipes } from "./recipes";

export const EPISODIC_ACTIVITY_INPUT = {
	timeZone: "UTC",
	coverageLimit: 100,
	watchDayLimit: 1000,
	entityId: "parent-1",
	parentEventLimit: 60,
	episodeEventLimit: 100,
	collectionEventLimit: 60,
	episodeProgressLimit: 100,
};

export const episodicActivityFixtureRecipe =
	episodicFixtureRecipes.activityRecipe(EPISODIC_ACTIVITY_INPUT);

const emptyEventProperties = {
	text: null,
	rating: null,
	timeSpent: null,
	isSpoiler: null,
	consumedOn: null,
};

const emptyParentProperties = { ...emptyEventProperties, startedOn: null, completedOn: null };

export const episodicCoverageRow = {
	id: "parent-1",
	episodeTotal: 4,
	watchedTotal: 2,
	upcomingTotal: 0,
	watchedMinutes: 116,
	watchedUnknownRuntime: 0,
};

export const episodicBacklogEventRow = {
	...emptyParentProperties,
	id: "parent-backlog",
	eventSchemaSlug: "backlog",
	createdAt: "2025-11-01T12:00:05.000Z",
	occurredAt: "2025-11-01T12:00:00.000Z",
};

export const episodicLibraryEventRow = {
	...emptyParentProperties,
	id: "parent-library",
	createdAt: "2025-11-01T00:00:05.000Z",
	occurredAt: "2025-11-01T00:00:00.000Z",
	eventSchemaSlug: "add-to-media-library",
};

export const episodicCompletionEventRow = {
	...emptyParentProperties,
	timeSpent: 240,
	id: "parent-complete",
	eventSchemaSlug: "complete",
	createdAt: "2025-11-06T12:00:05.000Z",
	occurredAt: "2025-11-06T12:00:00.000Z",
};

export const episodicReviewEventRow = {
	...emptyParentProperties,
	rating: 82,
	isSpoiler: false,
	id: "parent-review",
	eventSchemaSlug: "review",
	text: "A devastating listen.",
	createdAt: "2025-11-07T12:00:05.000Z",
	occurredAt: "2025-11-07T12:00:00.000Z",
};

export const episodicEpisodeReviewEventRow = {
	...emptyEventProperties,
	rating: 90,
	isSpoiler: true,
	episodeNumber: 1,
	episodeRuntime: 55,
	episodeId: "episode-1",
	id: "episode-1-review",
	eventSchemaSlug: "review",
	episodeName: "Episode 1: The Arrest",
	createdAt: "2025-11-05T10:00:05.000Z",
	occurredAt: "2025-11-05T10:00:00.000Z",
	text: "The arrest scene is the whole thing.",
};

export const episodicProgressRow = {
	episodeNumber: 3,
	consumedOn: "Plex",
	progressPercent: 40,
	episodeRuntime: null,
	episodeId: "episode-3",
	id: "episode-3-progress",
	episodeName: "Behind the scenes",
	createdAt: "2025-11-08T12:00:05.000Z",
	occurredAt: "2025-11-08T12:00:00.000Z",
};

export const episodicCollectionAddedEventRow = {
	id: "watchlist-added",
	collectionName: "Watchlist",
	collectionId: "collection-1",
	createdAt: "2025-11-02T09:00:05.000Z",
	occurredAt: "2025-11-02T09:00:00.000Z",
	eventSchemaSlug: "add-entity-to-collection",
};

export const episodicFirstWatchDayRow = {
	minutes: 66,
	runtime: 55,
	episodeNumber: 1,
	episodeId: "episode-1",
	consumedOn: "Jellyfin",
	day: "2025-11-04T00:00:00.000Z",
	episodeName: "Episode 1: The Arrest",
};

export const episodicSecondWatchDayRow = {
	runtime: 61,
	minutes: null,
	episodeNumber: 2,
	episodeId: "episode-2",
	consumedOn: "Jellyfin",
	day: "2025-11-05T00:00:00.000Z",
	episodeName: "Episode 2: The Interview",
};

export const episodicSameDayWatchRow = {
	...episodicSecondWatchDayRow,
	day: episodicFirstWatchDayRow.day,
};

export const episodicRewatchWatchDayRow = {
	...episodicFirstWatchDayRow,
	minutes: null,
	consumedOn: "Netflix",
	day: "2026-03-01T00:00:00.000Z",
};

export const episodicRewatchCompletionEventRow = {
	...emptyParentProperties,
	eventSchemaSlug: "complete",
	id: "parent-complete-rewatch",
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

export const decodeEpisodicActivity = (input: ActivityRows = {}) => {
	const hasMore = input.truncated === true;
	return Result.getOrThrow(
		episodicActivityFixtureRecipe.decode({
			data: {
				totals: activityRows([{ watchCount: input.watchCount ?? 1 }], false),
				coverage: activityRows(input.coverage ?? [episodicCoverageRow], false),
				episodeProgress: progressRows(input.episodeProgress ?? [episodicProgressRow]),
				episodeEvents: activityRows(input.episodeEvents ?? [episodicEpisodeReviewEventRow], false),
				collectionEvents: activityRows(
					input.collectionEvents ?? [episodicCollectionAddedEventRow],
					false,
				),
				watchDays: {
					type: "aggregate",
					pageInfo: { hasMore, limit: 1000 },
					items: input.watchDays ?? [episodicFirstWatchDayRow, episodicSecondWatchDayRow],
				},
				parentEvents: activityRows(
					input.parentEvents ?? [
						episodicLibraryEventRow,
						episodicBacklogEventRow,
						episodicCompletionEventRow,
						episodicReviewEventRow,
					],
					hasMore,
				),
			},
		}),
	);
};

export const emptyEpisodicActivity = () =>
	decodeEpisodicActivity({
		watchDays: [],
		watchCount: 0,
		parentEvents: [],
		episodeEvents: [],
		episodeProgress: [],
		collectionEvents: [],
	});

export const rewatchedEpisodicActivity = () =>
	decodeEpisodicActivity({
		watchCount: 2,
		episodeEvents: [],
		episodeProgress: [],
		collectionEvents: [],
		watchDays: [episodicRewatchWatchDayRow, episodicFirstWatchDayRow],
		parentEvents: [episodicCompletionEventRow, episodicRewatchCompletionEventRow],
	});
