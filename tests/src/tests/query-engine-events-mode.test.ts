import { describe, expect, it } from "bun:test";

import {
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
	type QueryEnginePayload,
} from "../fixtures";
import { assertPresent } from "../test-support/assertions";

const buildEventRowsDoc = (input: {
	entityAlias: string;
	eventAlias: string;
	entitySchemas: [string, ...string[]];
	eventSchemas: [string, ...string[]];
	fields: Extract<QueryEnginePayload["output"], { type: "rows" }>["fields"];
	orderBy: Extract<QueryEnginePayload["output"], { type: "rows" }>["orderBy"];
	where?: Extract<QueryEnginePayload["source"], { type: "events" }>["where"];
	page?: number;
	limit?: number;
}): QueryEnginePayload => ({
	source: {
		type: "events",
		alias: input.eventAlias,
		where: input.where ?? null,
		schemas: input.eventSchemas,
		entity: { alias: input.entityAlias, schemas: input.entitySchemas },
	},
	output: {
		type: "rows",
		fields: input.fields,
		orderBy: input.orderBy,
		pagination: { page: input.page ?? 1, limit: input.limit ?? 10 },
	},
});

describe("event root rows", () => {
	it("filters root events by an event property before returning rows", async () => {
		const { client } = await createAuthenticatedClient();
		const { schemaId, slug } = await createQueryEngineTrackerAndSchema(client, {
			schemaName: "EventFilterItem",
		});
		const reviewSlug = `event-filter-review-${crypto.randomUUID()}`;
		const reviewSchema = await createEventSchema(client, {
			slug: reviewSlug,
			name: "Event Filter Review",
			entitySchemaId: schemaId,
			propertiesSchema: {
				fields: {
					rating: { type: "integer", label: "Rating", description: "Rating" },
				},
			},
		});
		const entity = await createQueryEngineEntity(client, {
			name: "Event Filter Entity",
			entitySchemaId: schemaId,
		});

		await Promise.all(
			[1, 2, 3, 4, 5].map((rating) =>
				createQueryEngineEvent(client, {
					entityId: entity.id,
					properties: { rating },
					eventSchemaId: reviewSchema.id,
				}),
			),
		);

		const ratingRef = propertyRef("review", reviewSlug, "rating");
		const result = await executeQueryEngine(
			client,
			buildEventRowsDoc({
				fields: [{ key: "rating", expr: ratingRef }],
				orderBy: [{ order: "asc", expr: ratingRef }],
				entityAlias: "item",
				eventAlias: "review",
				entitySchemas: [slug],
				eventSchemas: [reviewSlug],
				where: {
					left: ratingRef,
					right: { type: "literal", value: 4 },
					type: "comparison",
					operator: "gte",
				},
			}),
		);

		expect(
			result.data.items.map((item) => requireQueryEngineFieldValue(item, "rating").value),
		).toEqual([4, 5]);
	});

	it("sorts root events by a numeric event property", async () => {
		const { client } = await createAuthenticatedClient();
		const { schemaId, slug } = await createQueryEngineTrackerAndSchema(client, {
			schemaName: "EventSortItem",
		});
		const reviewSlug = `event-sort-review-${crypto.randomUUID()}`;
		const reviewSchema = await createEventSchema(client, {
			slug: reviewSlug,
			name: "Event Sort Review",
			entitySchemaId: schemaId,
			propertiesSchema: {
				fields: {
					rating: { type: "integer", label: "Rating", description: "Rating" },
				},
			},
		});
		const entity = await createQueryEngineEntity(client, {
			name: "Event Sort Entity",
			entitySchemaId: schemaId,
		});

		await Promise.all(
			[3, 1, 5].map((rating) =>
				createQueryEngineEvent(client, {
					entityId: entity.id,
					properties: { rating },
					eventSchemaId: reviewSchema.id,
				}),
			),
		);

		const ratingRef = propertyRef("review", reviewSlug, "rating");
		const result = await executeQueryEngine(
			client,
			buildEventRowsDoc({
				fields: [{ key: "rating", expr: ratingRef }],
				orderBy: [{ order: "desc", expr: ratingRef }],
				entityAlias: "item",
				eventAlias: "review",
				entitySchemas: [slug],
				eventSchemas: [reviewSlug],
			}),
		);

		expect(
			result.data.items.map((item) => requireQueryEngineFieldValue(item, "rating").value),
		).toEqual([5, 3, 1]);
	});

	it("returns only events from the specified event schemas", async () => {
		const { client } = await createAuthenticatedClient();
		const { schemaId, slug } = await createQueryEngineTrackerAndSchema(client, {
			schemaName: "EventSchemaFilterItem",
		});
		const watchSlug = `event-watch-${crypto.randomUUID()}`;
		const reviewSlug = `event-review-${crypto.randomUUID()}`;
		const watchSchema = await createEventSchema(client, {
			slug: watchSlug,
			name: "Watch",
			entitySchemaId: schemaId,
			propertiesSchema: {
				fields: { note: { type: "string", label: "Note", description: "Note" } },
			},
		});
		const reviewSchema = await createEventSchema(client, {
			slug: reviewSlug,
			name: "Review",
			entitySchemaId: schemaId,
			propertiesSchema: {
				fields: { note: { type: "string", label: "Note", description: "Note" } },
			},
		});
		const entity = await createQueryEngineEntity(client, {
			name: "Schema Filter Entity",
			entitySchemaId: schemaId,
		});

		await createQueryEngineEvent(client, { entityId: entity.id, eventSchemaId: watchSchema.id });
		await createQueryEngineEvent(client, { entityId: entity.id, eventSchemaId: reviewSchema.id });

		const result = await executeQueryEngine(
			client,
			buildEventRowsDoc({
				fields: [{ key: "eventSchema", expr: schemaMetaRef("event", "slug") }],
				orderBy: [{ order: "asc", expr: systemRef("event", "createdAt") }],
				entityAlias: "item",
				eventAlias: "event",
				entitySchemas: [slug],
				eventSchemas: [watchSlug],
			}),
		);

		expect(result.data.items).toHaveLength(1);
		const item = result.data.items[0];
		assertPresent(item, "Missing filtered event row");
		expect(requireQueryEngineFieldValue(item, "eventSchema").value).toBe(watchSlug);
	});

	it("returns events as primary rows with pagination metadata", async () => {
		const { client } = await createAuthenticatedClient();
		const { schemaId, slug } = await createQueryEngineTrackerAndSchema(client, {
			schemaName: "PrimaryRowItem",
		});
		const watchSlug = `primary-row-watch-${crypto.randomUUID()}`;
		const watchSchema = await createEventSchema(client, {
			slug: watchSlug,
			name: "Primary Row Watch",
			entitySchemaId: schemaId,
			propertiesSchema: {
				fields: { note: { type: "string", label: "Note", description: "Note" } },
			},
		});
		const entity = await createQueryEngineEntity(client, {
			name: "Primary Row Entity",
			entitySchemaId: schemaId,
		});

		await createQueryEngineEvent(client, { entityId: entity.id, eventSchemaId: watchSchema.id });
		await createQueryEngineEvent(client, { entityId: entity.id, eventSchemaId: watchSchema.id });

		const result = await executeQueryEngine(
			client,
			buildEventRowsDoc({
				fields: [{ key: "eventId", expr: systemRef("watch", "id") }],
				orderBy: [{ order: "asc", expr: systemRef("watch", "createdAt") }],
				entityAlias: "item",
				eventAlias: "watch",
				entitySchemas: [slug],
				eventSchemas: [watchSlug],
			}),
		);

		expect(result.data.items).toHaveLength(2);
		expect(result.data.pageInfo.total).toBe(2);
		expect(result.data.pageInfo.hasMore).toBe(false);
		for (const item of result.data.items) {
			expect(typeof requireQueryEngineFieldValue(item, "eventId").value).toBe("string");
		}
	});

	it("returns entity name and event schema slug alongside events", async () => {
		const { client } = await createAuthenticatedClient();
		const { schemaId, slug } = await createQueryEngineTrackerAndSchema(client, {
			schemaName: "EventRefsItem",
		});
		const reviewSlug = `event-refs-review-${crypto.randomUUID()}`;
		const reviewSchema = await createEventSchema(client, {
			slug: reviewSlug,
			name: "Event Refs Review",
			entitySchemaId: schemaId,
			propertiesSchema: {
				fields: { rating: { type: "integer", label: "Rating", description: "Rating" } },
			},
		});
		const entity = await createQueryEngineEntity(client, {
			name: "Named Entity",
			entitySchemaId: schemaId,
		});

		await createQueryEngineEvent(client, {
			entityId: entity.id,
			properties: { rating: 4 },
			eventSchemaId: reviewSchema.id,
		});

		const result = await executeQueryEngine(
			client,
			buildEventRowsDoc({
				fields: [
					{ key: "entityName", expr: systemRef("item", "name") },
					{ key: "eventSchemaSlug", expr: schemaMetaRef("review", "slug") },
					{ key: "rating", expr: propertyRef("review", reviewSlug, "rating") },
				],
				orderBy: [{ order: "asc", expr: systemRef("review", "createdAt") }],
				entityAlias: "item",
				eventAlias: "review",
				entitySchemas: [slug],
				eventSchemas: [reviewSlug],
			}),
		);

		expect(result.data.items).toHaveLength(1);
		const item = result.data.items[0];
		assertPresent(item, "Missing event row");
		expect(requireQueryEngineFieldValue(item, "entityName").value).toBe("Named Entity");
		expect(requireQueryEngineFieldValue(item, "eventSchemaSlug").value).toBe(reviewSlug);
		expect(requireQueryEngineFieldValue(item, "rating").value).toBe(4);
	});

	it("returns correct paginated results and metadata in events mode", async () => {
		const { client } = await createAuthenticatedClient();
		const { schemaId, slug } = await createQueryEngineTrackerAndSchema(client, {
			schemaName: "EventPaginationItem",
		});
		const watchSlug = `event-pagination-watch-${crypto.randomUUID()}`;
		const watchSchema = await createEventSchema(client, {
			slug: watchSlug,
			name: "Event Pagination Watch",
			entitySchemaId: schemaId,
			propertiesSchema: {
				fields: { seq: { type: "integer", label: "Seq", description: "Seq" } },
			},
		});
		const entity = await createQueryEngineEntity(client, {
			name: "Pagination Entity",
			entitySchemaId: schemaId,
		});

		await Promise.all(
			[1, 2, 3, 4, 5].map((seq) =>
				createQueryEngineEvent(client, {
					entityId: entity.id,
					properties: { seq },
					eventSchemaId: watchSchema.id,
				}),
			),
		);

		const seqRef = propertyRef("watch", watchSlug, "seq");

		const page1 = await executeQueryEngine(
			client,
			buildEventRowsDoc({
				fields: [{ key: "seq", expr: seqRef }],
				orderBy: [{ order: "asc", expr: seqRef }],
				entityAlias: "item",
				eventAlias: "watch",
				entitySchemas: [slug],
				eventSchemas: [watchSlug],
				page: 1,
				limit: 2,
			}),
		);
		const page3 = await executeQueryEngine(
			client,
			buildEventRowsDoc({
				fields: [{ key: "seq", expr: seqRef }],
				orderBy: [{ order: "asc", expr: seqRef }],
				entityAlias: "item",
				eventAlias: "watch",
				entitySchemas: [slug],
				eventSchemas: [watchSlug],
				page: 3,
				limit: 2,
			}),
		);

		expect(page1.data.items).toHaveLength(2);
		expect(page1.data.pageInfo).toMatchObject({ page: 1, total: 5, limit: 2, hasMore: true });
		expect(getQueryEngineFieldOrThrow(page1.data.items[0], "seq").value).toBe(1);

		expect(page3.data.items).toHaveLength(1);
		expect(page3.data.pageInfo).toMatchObject({ page: 3, total: 5, limit: 2, hasMore: false });
		expect(getQueryEngineFieldOrThrow(page3.data.items[0], "seq").value).toBe(5);
	});

	it("attaches latest event data to each event row via a first expression", async () => {
		const { client } = await createAuthenticatedClient();
		const { schemaId, slug } = await createQueryEngineTrackerAndSchema(client, {
			schemaName: "EventJoinItem",
		});
		const watchSlug = `event-join-watch-${crypto.randomUUID()}`;
		const reviewSlug = `event-join-review-${crypto.randomUUID()}`;
		const watchSchema = await createEventSchema(client, {
			slug: watchSlug,
			name: "Watch",
			entitySchemaId: schemaId,
			propertiesSchema: {
				fields: { note: { type: "string", label: "Note", description: "Note" } },
			},
		});
		const reviewSchema = await createEventSchema(client, {
			slug: reviewSlug,
			name: "Review",
			entitySchemaId: schemaId,
			propertiesSchema: {
				fields: { rating: { type: "integer", label: "Rating", description: "Rating" } },
			},
		});
		const entity = await createQueryEngineEntity(client, {
			name: "Event Join Entity",
			entitySchemaId: schemaId,
		});

		await createQueryEngineEvent(client, {
			entityId: entity.id,
			properties: { note: "first watch" },
			eventSchemaId: watchSchema.id,
		});
		await createQueryEngineEvent(client, {
			entityId: entity.id,
			properties: { note: "second watch" },
			eventSchemaId: watchSchema.id,
		});
		await createQueryEngineEvent(client, {
			entityId: entity.id,
			properties: { rating: 7 },
			eventSchemaId: reviewSchema.id,
			occurredAt: "2026-02-01T00:00:00.000Z",
		});

		const result = await executeQueryEngine(
			client,
			buildEventRowsDoc({
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
								alias: "latestReview",
								entityRef: "item",
								schemas: [reviewSlug],
							},
						},
					},
				],
				orderBy: [{ order: "asc", expr: systemRef("watch", "createdAt") }],
				entityAlias: "item",
				eventAlias: "watch",
				entitySchemas: [slug],
				eventSchemas: [watchSlug],
			}),
		);

		expect(result.data.items).toHaveLength(2);
		for (const item of result.data.items) {
			expect(requireQueryEngineFieldValue(item, "latestRating").value).toBe(7);
		}
	});
});
