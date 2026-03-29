import { Effect } from "effect";

import {
	buildEventRowsDoc,
	createAuthenticatedClient,
	createEventSchema,
	createQueryEngineEntity,
	createQueryEngineEvent,
	createQueryEngineTrackerAndSchema,
	executeQueryEngine,
	getQueryEngineFieldOrThrow,
	propertyRef,
	requireQueryEngineFieldValue,
	schemaMetaRef,
	systemRef,
} from "~/fixtures";
import { assertPresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

describe("event root rows", () => {
	it.live("filters root events by an event property before returning rows", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schemaId, slug } = yield* createQueryEngineTrackerAndSchema(client, {
				schemaName: "EventFilterItem",
			});
			const reviewSlug = `event-filter-review-${crypto.randomUUID()}`;
			const reviewSchema = yield* createEventSchema(client, {
				slug: reviewSlug,
				entitySchemaSlug: schemaId,
				name: "Event Filter Review",
				propertiesSchema: {
					fields: { rating: { type: "integer", label: "Rating", description: "Rating" } },
				},
			});
			const entity = yield* createQueryEngineEntity(client, {
				entitySchemaSlug: schemaId,
				name: "Event Filter Entity",
			});

			yield* Effect.all(
				[1, 2, 3, 4, 5].map((rating) =>
					createQueryEngineEvent(client, {
						entityId: entity.id,
						properties: { rating },
						eventSchemaSlug: reviewSchema.id,
					}),
				),
			);

			const ratingRef = propertyRef("review", reviewSlug, "rating");
			const result = yield* executeQueryEngine(
				client,
				buildEventRowsDoc({
					entityAlias: "item",
					eventAlias: "review",
					entitySchemas: [slug],
					eventSchemas: [reviewSlug],
					fields: [{ key: "rating", expr: ratingRef }],
					orderBy: [{ order: "asc", expr: ratingRef }],
					where: {
						left: ratingRef,
						operator: "gte",
						type: "comparison",
						right: { type: "literal", value: 4 },
					},
				}),
			);

			expect(
				result.data.items.map((item) => requireQueryEngineFieldValue(item, "rating").value),
			).toEqual([4, 5]);
		}),
	);

	it.live("sorts root events by a numeric event property", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schemaId, slug } = yield* createQueryEngineTrackerAndSchema(client, {
				schemaName: "EventSortItem",
			});
			const reviewSlug = `event-sort-review-${crypto.randomUUID()}`;
			const reviewSchema = yield* createEventSchema(client, {
				slug: reviewSlug,
				entitySchemaSlug: schemaId,
				name: "Event Sort Review",
				propertiesSchema: {
					fields: { rating: { type: "integer", label: "Rating", description: "Rating" } },
				},
			});
			const entity = yield* createQueryEngineEntity(client, {
				entitySchemaSlug: schemaId,
				name: "Event Sort Entity",
			});

			yield* Effect.all(
				[3, 1, 5].map((rating) =>
					createQueryEngineEvent(client, {
						entityId: entity.id,
						properties: { rating },
						eventSchemaSlug: reviewSchema.id,
					}),
				),
			);

			const ratingRef = propertyRef("review", reviewSlug, "rating");
			const result = yield* executeQueryEngine(
				client,
				buildEventRowsDoc({
					entityAlias: "item",
					eventAlias: "review",
					entitySchemas: [slug],
					eventSchemas: [reviewSlug],
					fields: [{ key: "rating", expr: ratingRef }],
					orderBy: [{ order: "desc", expr: ratingRef }],
				}),
			);

			expect(
				result.data.items.map((item) => requireQueryEngineFieldValue(item, "rating").value),
			).toEqual([5, 3, 1]);
		}),
	);

	it.live("returns only events from the specified event schemas", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schemaId, slug } = yield* createQueryEngineTrackerAndSchema(client, {
				schemaName: "EventSchemaFilterItem",
			});
			const watchSlug = `event-watch-${crypto.randomUUID()}`;
			const reviewSlug = `event-review-${crypto.randomUUID()}`;
			const watchSchema = yield* createEventSchema(client, {
				name: "Watch",
				slug: watchSlug,
				entitySchemaSlug: schemaId,
				propertiesSchema: {
					fields: { note: { type: "string", label: "Note", description: "Note" } },
				},
			});
			const reviewSchema = yield* createEventSchema(client, {
				name: "Review",
				slug: reviewSlug,
				entitySchemaSlug: schemaId,
				propertiesSchema: {
					fields: { note: { type: "string", label: "Note", description: "Note" } },
				},
			});
			const entity = yield* createQueryEngineEntity(client, {
				entitySchemaSlug: schemaId,
				name: "Schema Filter Entity",
			});

			yield* createQueryEngineEvent(client, {
				entityId: entity.id,
				eventSchemaSlug: watchSchema.id,
			});
			yield* createQueryEngineEvent(client, {
				entityId: entity.id,
				eventSchemaSlug: reviewSchema.id,
			});

			const result = yield* executeQueryEngine(
				client,
				buildEventRowsDoc({
					entityAlias: "item",
					eventAlias: "event",
					entitySchemas: [slug],
					eventSchemas: [watchSlug],
					fields: [{ key: "eventSchema", expr: schemaMetaRef("event", "slug") }],
					orderBy: [{ order: "asc", expr: systemRef("event", "createdAt") }],
				}),
			);

			expect(result.data.items).toHaveLength(1);
			const item = result.data.items[0];
			assertPresent(item, "Missing filtered event row");
			expect(requireQueryEngineFieldValue(item, "eventSchema").value).toBe(watchSlug);
		}),
	);

	it.live("returns events as primary rows with pagination metadata", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schemaId, slug } = yield* createQueryEngineTrackerAndSchema(client, {
				schemaName: "PrimaryRowItem",
			});
			const watchSlug = `primary-row-watch-${crypto.randomUUID()}`;
			const watchSchema = yield* createEventSchema(client, {
				slug: watchSlug,
				entitySchemaSlug: schemaId,
				name: "Primary Row Watch",
				propertiesSchema: {
					fields: { note: { type: "string", label: "Note", description: "Note" } },
				},
			});
			const entity = yield* createQueryEngineEntity(client, {
				entitySchemaSlug: schemaId,
				name: "Primary Row Entity",
			});

			yield* createQueryEngineEvent(client, {
				entityId: entity.id,
				eventSchemaSlug: watchSchema.id,
			});
			yield* createQueryEngineEvent(client, {
				entityId: entity.id,
				eventSchemaSlug: watchSchema.id,
			});

			const result = yield* executeQueryEngine(
				client,
				buildEventRowsDoc({
					entityAlias: "item",
					eventAlias: "watch",
					entitySchemas: [slug],
					eventSchemas: [watchSlug],
					fields: [{ key: "eventId", expr: systemRef("watch", "id") }],
					orderBy: [{ order: "asc", expr: systemRef("watch", "createdAt") }],
				}),
			);

			expect(result.data.items).toHaveLength(2);
			expect(result.data.pageInfo.total).toBe(2);
			expect(result.data.pageInfo.hasMore).toBe(false);
			for (const item of result.data.items) {
				expect(typeof requireQueryEngineFieldValue(item, "eventId").value).toBe("string");
			}
		}),
	);

	it.live("returns entity name and event schema slug alongside events", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schemaId, slug } = yield* createQueryEngineTrackerAndSchema(client, {
				schemaName: "EventRefsItem",
			});
			const reviewSlug = `event-refs-review-${crypto.randomUUID()}`;
			const reviewSchema = yield* createEventSchema(client, {
				slug: reviewSlug,
				name: "Event Refs Review",
				entitySchemaSlug: schemaId,
				propertiesSchema: {
					fields: { rating: { type: "integer", label: "Rating", description: "Rating" } },
				},
			});
			const entity = yield* createQueryEngineEntity(client, {
				name: "Named Entity",
				entitySchemaSlug: schemaId,
			});

			yield* createQueryEngineEvent(client, {
				entityId: entity.id,
				properties: { rating: 4 },
				eventSchemaSlug: reviewSchema.id,
			});

			const result = yield* executeQueryEngine(
				client,
				buildEventRowsDoc({
					entityAlias: "item",
					eventAlias: "review",
					entitySchemas: [slug],
					eventSchemas: [reviewSlug],
					orderBy: [{ order: "asc", expr: systemRef("review", "createdAt") }],
					fields: [
						{ key: "entityName", expr: systemRef("item", "name") },
						{ key: "eventSchemaSlug", expr: schemaMetaRef("review", "slug") },
						{ key: "rating", expr: propertyRef("review", reviewSlug, "rating") },
					],
				}),
			);

			expect(result.data.items).toHaveLength(1);
			const item = result.data.items[0];
			assertPresent(item, "Missing event row");
			expect(requireQueryEngineFieldValue(item, "entityName").value).toBe("Named Entity");
			expect(requireQueryEngineFieldValue(item, "eventSchemaSlug").value).toBe(reviewSlug);
			expect(requireQueryEngineFieldValue(item, "rating").value).toBe(4);
		}),
	);

	it.live("returns correct paginated results and metadata in events mode", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schemaId, slug } = yield* createQueryEngineTrackerAndSchema(client, {
				schemaName: "EventPaginationItem",
			});
			const watchSlug = `event-pagination-watch-${crypto.randomUUID()}`;
			const watchSchema = yield* createEventSchema(client, {
				slug: watchSlug,
				entitySchemaSlug: schemaId,
				name: "Event Pagination Watch",
				propertiesSchema: {
					fields: { seq: { type: "integer", label: "Seq", description: "Seq" } },
				},
			});
			const entity = yield* createQueryEngineEntity(client, {
				name: "Pagination Entity",
				entitySchemaSlug: schemaId,
			});

			yield* Effect.all(
				[1, 2, 3, 4, 5].map((seq) =>
					createQueryEngineEvent(client, {
						entityId: entity.id,
						properties: { seq },
						eventSchemaSlug: watchSchema.id,
					}),
				),
			);

			const seqRef = propertyRef("watch", watchSlug, "seq");

			const page1 = yield* executeQueryEngine(
				client,
				buildEventRowsDoc({
					page: 1,
					limit: 2,
					entityAlias: "item",
					eventAlias: "watch",
					entitySchemas: [slug],
					eventSchemas: [watchSlug],
					fields: [{ key: "seq", expr: seqRef }],
					orderBy: [{ order: "asc", expr: seqRef }],
				}),
			);
			const page3 = yield* executeQueryEngine(
				client,
				buildEventRowsDoc({
					page: 3,
					limit: 2,
					entityAlias: "item",
					eventAlias: "watch",
					entitySchemas: [slug],
					eventSchemas: [watchSlug],
					fields: [{ key: "seq", expr: seqRef }],
					orderBy: [{ order: "asc", expr: seqRef }],
				}),
			);

			expect(page1.data.items).toHaveLength(2);
			expect(page1.data.pageInfo).toMatchObject({ page: 1, total: 5, limit: 2, hasMore: true });
			expect(getQueryEngineFieldOrThrow(page1.data.items[0], "seq").value).toBe(1);

			expect(page3.data.items).toHaveLength(1);
			expect(page3.data.pageInfo).toMatchObject({ page: 3, total: 5, limit: 2, hasMore: false });
			expect(getQueryEngineFieldOrThrow(page3.data.items[0], "seq").value).toBe(5);
		}),
	);

	it.live("attaches latest event data to each event row via a first expression", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schemaId, slug } = yield* createQueryEngineTrackerAndSchema(client, {
				schemaName: "EventJoinItem",
			});
			const watchSlug = `event-join-watch-${crypto.randomUUID()}`;
			const reviewSlug = `event-join-review-${crypto.randomUUID()}`;
			const watchSchema = yield* createEventSchema(client, {
				name: "Watch",
				slug: watchSlug,
				entitySchemaSlug: schemaId,
				propertiesSchema: {
					fields: { note: { type: "string", label: "Note", description: "Note" } },
				},
			});
			const reviewSchema = yield* createEventSchema(client, {
				name: "Review",
				slug: reviewSlug,
				entitySchemaSlug: schemaId,
				propertiesSchema: {
					fields: { rating: { type: "integer", label: "Rating", description: "Rating" } },
				},
			});
			const entity = yield* createQueryEngineEntity(client, {
				entitySchemaSlug: schemaId,
				name: "Event Join Entity",
			});

			yield* createQueryEngineEvent(client, {
				entityId: entity.id,
				eventSchemaSlug: watchSchema.id,
				properties: { note: "first watch" },
			});
			yield* createQueryEngineEvent(client, {
				entityId: entity.id,
				eventSchemaSlug: watchSchema.id,
				properties: { note: "second watch" },
			});
			yield* createQueryEngineEvent(client, {
				entityId: entity.id,
				properties: { rating: 7 },
				eventSchemaSlug: reviewSchema.id,
				occurredAt: "2026-02-01T00:00:00.000Z",
			});

			const result = yield* executeQueryEngine(
				client,
				buildEventRowsDoc({
					entityAlias: "item",
					eventAlias: "watch",
					entitySchemas: [slug],
					eventSchemas: [watchSlug],
					orderBy: [{ order: "asc", expr: systemRef("watch", "createdAt") }],
					fields: [
						{
							key: "latestRating",
							expr: {
								type: "first",
								select: propertyRef("latestReview", reviewSlug, "rating"),
								orderBy: [{ order: "desc", expr: systemRef("latestReview", "occurredAt") }],
								source: {
									where: null,
									type: "events",
									entityRef: "item",
									alias: "latestReview",
									schemas: [reviewSlug],
								},
							},
						},
					],
				}),
			);

			expect(result.data.items).toHaveLength(2);
			for (const item of result.data.items) {
				expect(requireQueryEngineFieldValue(item, "latestRating").value).toBe(7);
			}
		}),
	);
});
