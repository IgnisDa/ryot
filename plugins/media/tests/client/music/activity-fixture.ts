import { Result } from "@ryot-app/client-sdk/effect";

import { musicActivityRecipe } from "../../../shared/music-recipes";
import { rowsResult } from "../query-result-fixture";

const musicActivityFixtureRecipe = musicActivityRecipe({
	eventLimit: 60,
	entityId: "music-1",
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

export const musicBacklogEventRow = {
	...emptyEventProperties,
	id: "music-backlog",
	eventSchemaSlug: "backlog",
	createdAt: "2025-11-01T12:00:05.000Z",
	occurredAt: "2025-11-01T12:00:00.000Z",
};

export const musicProgressEventRow = {
	...emptyEventProperties,
	progressPercent: 42,
	id: "music-progress",
	consumedOn: "Spotify",
	eventSchemaSlug: "progress",
	createdAt: "2025-11-03T12:00:05.000Z",
	occurredAt: "2025-11-03T12:00:00.000Z",
};

export const musicCompletionEventRow = {
	...emptyEventProperties,
	id: "music-complete",
	eventSchemaSlug: "complete",
	createdAt: "2025-11-04T12:00:05.000Z",
	occurredAt: "2025-11-04T12:00:00.000Z",
};

export const musicReviewEventRow = {
	...emptyEventProperties,
	rating: 96,
	isSpoiler: false,
	id: "music-review",
	eventSchemaSlug: "review",
	text: "Three songs in one.",
	createdAt: "2025-11-05T12:00:05.000Z",
	occurredAt: "2025-11-05T12:00:00.000Z",
};

export const musicRelistenCompletionEventRow = {
	...emptyEventProperties,
	eventSchemaSlug: "complete",
	id: "music-complete-relisten",
	createdAt: "2026-03-02T12:00:05.000Z",
	occurredAt: "2026-03-02T12:00:00.000Z",
};

export const musicCollectionAddedEventRow = {
	id: "playlist-added",
	collectionName: "Favourites",
	collectionId: "collection-1",
	createdAt: "2025-11-02T09:00:05.000Z",
	occurredAt: "2025-11-02T09:00:00.000Z",
	eventSchemaSlug: "add-entity-to-collection",
};

type ActivityRows = {
	readonly truncated?: boolean;
	readonly completionCount?: number;
	readonly consumedMinutes?: number | null;
	readonly unknownDurationCount?: number;
	readonly musicEvents?: readonly Record<string, unknown>[];
	readonly collectionEvents?: readonly Record<string, unknown>[];
};

const activityRows = (items: readonly Record<string, unknown>[], hasMore: boolean) =>
	rowsResult(items, { hasMore, limit: 60, nextCursor: hasMore ? "activity-cursor" : null });

export const decodeMusicActivity = (input: ActivityRows = {}) => {
	const hasMore = input.truncated === true;
	return Result.getOrThrow(
		musicActivityFixtureRecipe.decode({
			data: {
				collectionEvents: activityRows(
					input.collectionEvents ?? [musicCollectionAddedEventRow],
					false,
				),
				musicEvents: activityRows(
					input.musicEvents ?? [
						musicBacklogEventRow,
						musicProgressEventRow,
						musicCompletionEventRow,
						musicReviewEventRow,
					],
					hasMore,
				),
				totals: activityRows(
					[
						{
							completionCount: input.completionCount ?? 1,
							consumedMinutes: input.consumedMinutes ?? 3.7,
							unknownDurationCount: input.unknownDurationCount ?? 0,
						},
					],
					false,
				),
			},
		}),
	);
};

export const emptyMusicActivity = () =>
	decodeMusicActivity({
		musicEvents: [],
		completionCount: 0,
		collectionEvents: [],
		consumedMinutes: null,
	});

export const relistenedMusicActivity = () =>
	decodeMusicActivity({
		completionCount: 2,
		collectionEvents: [],
		musicEvents: [
			musicBacklogEventRow,
			musicProgressEventRow,
			musicCompletionEventRow,
			musicRelistenCompletionEventRow,
		],
	});
