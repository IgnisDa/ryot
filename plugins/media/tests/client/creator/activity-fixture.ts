import { Result } from "@ryot-app/plugin-client-sdk/effect";

import { rowsResult } from "../query-result-fixture";
import { creatorFixtureRecipes } from "./recipes";

const creatorActivityRecipe = creatorFixtureRecipes.activityRecipe({
	eventLimit: 60,
	entityId: "creator-1",
	collectionEventLimit: 60,
	reference: { kind: "self" },
});

export const creatorReviewEventRow = {
	rating: 88,
	properties: {},
	isSpoiler: false,
	entityId: "entity-1",
	id: "creator-review",
	sessionEntityId: null,
	eventSchemaSlug: "review",
	text: "A generational talent.",
	createdAt: "2025-11-05T12:00:05.000Z",
	occurredAt: "2025-11-05T12:00:00.000Z",
};

export const creatorLibraryEventRow = {
	text: null,
	rating: null,
	properties: {},
	isSpoiler: null,
	entityId: "entity-1",
	sessionEntityId: null,
	id: "creator-library",
	createdAt: "2025-11-01T00:00:05.000Z",
	occurredAt: "2025-11-01T00:00:00.000Z",
	eventSchemaSlug: "add-to-media-library",
};

export const creatorCollectionAddedEventRow = {
	id: "favourites-added",
	collectionName: "Favourites",
	collectionId: "collection-1",
	createdAt: "2025-11-02T09:00:05.000Z",
	occurredAt: "2025-11-02T09:00:00.000Z",
	eventSchemaSlug: "add-entity-to-collection",
};

const activityRows = (items: readonly Record<string, unknown>[], hasMore: boolean) =>
	rowsResult(items, { hasMore, limit: 60, nextCursor: hasMore ? "activity-cursor" : null });

export const creatorActivityData = (
	input: {
		readonly truncated?: boolean;
		readonly reviewCount?: number;
		readonly events?: readonly Record<string, unknown>[];
		readonly collectionEvents?: readonly Record<string, unknown>[];
	} = {},
) => ({
	totals: activityRows([{ reviewCount: input.reviewCount ?? 1 }], false),
	collectionEvents: activityRows(input.collectionEvents ?? [creatorCollectionAddedEventRow], false),
	events: activityRows(
		input.events ?? [creatorLibraryEventRow, creatorReviewEventRow],
		input.truncated === true,
	),
});

export const decodeCreatorActivity = (input: Parameters<typeof creatorActivityData>[0] = {}) =>
	Result.getOrThrow(creatorActivityRecipe.decode({ data: creatorActivityData(input) }));
