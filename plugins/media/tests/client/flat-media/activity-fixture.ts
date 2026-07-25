import { Result } from "@ryot-app/client-sdk/effect";

import { rowsResult } from "../query-result-fixture";
import { flatFixtureRecipes } from "./recipes";

const fixtureActivityRecipe = flatFixtureRecipes.activityRecipe({
	eventLimit: 60,
	entityId: "media-1",
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

export const flatBacklogEventRow = {
	...emptyEventProperties,
	id: "media-backlog",
	eventSchemaSlug: "backlog",
	createdAt: "2025-11-01T12:00:05.000Z",
	occurredAt: "2025-11-01T12:00:00.000Z",
};

export const flatProgressEventRow = {
	...emptyEventProperties,
	progressPercent: 42,
	id: "media-progress",
	consumedOn: "Jellyfin",
	eventSchemaSlug: "progress",
	createdAt: "2025-11-03T12:00:05.000Z",
	occurredAt: "2025-11-03T12:00:00.000Z",
};

export const flatCompletionEventRow = {
	...emptyEventProperties,
	timeSpent: 169,
	id: "media-complete",
	eventSchemaSlug: "complete",
	createdAt: "2025-11-04T12:00:05.000Z",
	occurredAt: "2025-11-04T12:00:00.000Z",
};

export const flatReviewEventRow = {
	...emptyEventProperties,
	rating: 91,
	isSpoiler: false,
	id: "media-review",
	eventSchemaSlug: "review",
	text: "The twist still lands.",
	createdAt: "2025-11-05T12:00:05.000Z",
	occurredAt: "2025-11-05T12:00:00.000Z",
};

export const flatRepeatCompletionEventRow = {
	...emptyEventProperties,
	timeSpent: 169,
	eventSchemaSlug: "complete",
	id: "media-complete-repeat",
	createdAt: "2026-03-02T12:00:05.000Z",
	occurredAt: "2026-03-02T12:00:00.000Z",
};

export const flatCollectionAddedEventRow = {
	id: "watchlist-added",
	collectionName: "Watchlist",
	collectionId: "collection-1",
	createdAt: "2025-11-02T09:00:05.000Z",
	occurredAt: "2025-11-02T09:00:00.000Z",
	eventSchemaSlug: "add-entity-to-collection",
};

type ActivityRows = {
	readonly truncated?: boolean;
	readonly completionCount?: number;
	readonly consumedAmount?: number | null;
	readonly unknownAmountCount?: number;
	readonly events?: readonly Record<string, unknown>[];
	readonly collectionEvents?: readonly Record<string, unknown>[];
};

const activityRows = (items: readonly Record<string, unknown>[], hasMore: boolean) =>
	rowsResult(items, { hasMore, limit: 60, nextCursor: hasMore ? "activity-cursor" : null });

export const decodeFlatActivity = (input: ActivityRows = {}) =>
	Result.getOrThrow(
		fixtureActivityRecipe.decode({
			data: {
				collectionEvents: activityRows(
					input.collectionEvents ?? [flatCollectionAddedEventRow],
					false,
				),
				events: activityRows(
					input.events ?? [
						flatBacklogEventRow,
						flatProgressEventRow,
						flatCompletionEventRow,
						flatReviewEventRow,
					],
					input.truncated === true,
				),
				totals: activityRows(
					[
						{
							completionCount: input.completionCount ?? 1,
							unknownAmountCount: input.unknownAmountCount ?? 0,
							consumedAmount: input.consumedAmount === undefined ? 169 : input.consumedAmount,
						},
					],
					false,
				),
			},
		}),
	);

export const emptyFlatActivity = () =>
	decodeFlatActivity({
		events: [],
		completionCount: 0,
		consumedAmount: null,
		collectionEvents: [],
	});

export const repeatedFlatActivity = () =>
	decodeFlatActivity({
		completionCount: 2,
		collectionEvents: [],
		events: [
			flatBacklogEventRow,
			flatProgressEventRow,
			flatCompletionEventRow,
			flatRepeatCompletionEventRow,
		],
	});
