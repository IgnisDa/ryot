import { Result } from "@ryot-app/client-sdk/effect";

import { movieActivityRecipe } from "../../../shared/movie-recipes";
import { rowsResult } from "../query-result-fixture";

const movieActivityFixtureRecipe = movieActivityRecipe({
	eventLimit: 60,
	entityId: "movie-1",
	collectionEventLimit: 60,
});

const emptyEventProperties = {
	text: null,
	rating: null,
	startedOn: null,
	timeSpent: null,
	isSpoiler: null,
	consumedOn: null,
	completedOn: null,
	progressPercent: null,
};

export const movieBacklogEventRow = {
	...emptyEventProperties,
	id: "movie-backlog",
	eventSchemaSlug: "backlog",
	createdAt: "2025-11-01T12:00:05.000Z",
	occurredAt: "2025-11-01T12:00:00.000Z",
};

export const movieProgressEventRow = {
	...emptyEventProperties,
	progressPercent: 42,
	id: "movie-progress",
	consumedOn: "Jellyfin",
	eventSchemaSlug: "progress",
	createdAt: "2025-11-03T12:00:05.000Z",
	occurredAt: "2025-11-03T12:00:00.000Z",
};

export const movieCompletionEventRow = {
	...emptyEventProperties,
	timeSpent: 169,
	id: "movie-complete",
	eventSchemaSlug: "complete",
	createdAt: "2025-11-04T12:00:05.000Z",
	occurredAt: "2025-11-04T12:00:00.000Z",
};

export const movieReviewEventRow = {
	...emptyEventProperties,
	rating: 91,
	isSpoiler: false,
	id: "movie-review",
	eventSchemaSlug: "review",
	text: "The twist still lands.",
	createdAt: "2025-11-05T12:00:05.000Z",
	occurredAt: "2025-11-05T12:00:00.000Z",
};

export const movieRewatchCompletionEventRow = {
	...emptyEventProperties,
	timeSpent: 169,
	eventSchemaSlug: "complete",
	id: "movie-complete-rewatch",
	createdAt: "2026-03-02T12:00:05.000Z",
	occurredAt: "2026-03-02T12:00:00.000Z",
};

export const collectionAddedEventRow = {
	id: "watchlist-added",
	collectionName: "Watchlist",
	collectionId: "collection-1",
	createdAt: "2025-11-02T09:00:05.000Z",
	occurredAt: "2025-11-02T09:00:00.000Z",
	eventSchemaSlug: "add-entity-to-collection",
};

type ActivityRows = {
	readonly truncated?: boolean;
	readonly watchCount?: number;
	readonly watchedMinutes?: number | null;
	readonly watchedUnknownRuntime?: number;
	readonly movieEvents?: readonly Record<string, unknown>[];
	readonly collectionEvents?: readonly Record<string, unknown>[];
};

const activityRows = (items: readonly Record<string, unknown>[], hasMore: boolean) =>
	rowsResult(items, { hasMore, limit: 60, nextCursor: hasMore ? "activity-cursor" : null });

export const decodeMovieActivity = (input: ActivityRows = {}) => {
	const hasMore = input.truncated === true;
	return Result.getOrThrow(
		movieActivityFixtureRecipe.decode({
			data: {
				collectionEvents: activityRows(input.collectionEvents ?? [collectionAddedEventRow], false),
				movieEvents: activityRows(
					input.movieEvents ?? [
						movieBacklogEventRow,
						movieProgressEventRow,
						movieCompletionEventRow,
						movieReviewEventRow,
					],
					hasMore,
				),
				totals: activityRows(
					[
						{
							watchCount: input.watchCount ?? 1,
							watchedMinutes: input.watchedMinutes ?? 169,
							watchedUnknownRuntime: input.watchedUnknownRuntime ?? 0,
						},
					],
					false,
				),
			},
		}),
	);
};

export const emptyMovieActivity = () =>
	decodeMovieActivity({
		watchCount: 0,
		movieEvents: [],
		watchedMinutes: null,
		collectionEvents: [],
	});

export const rewatchedMovieActivity = () =>
	decodeMovieActivity({
		watchCount: 2,
		collectionEvents: [],
		movieEvents: [
			movieBacklogEventRow,
			movieProgressEventRow,
			movieCompletionEventRow,
			movieRewatchCompletionEventRow,
		],
	});
