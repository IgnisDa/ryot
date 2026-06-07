import { describe, expect, it } from "bun:test";

import { createEntityColumnExpression } from "@ryot/ts-utils/view-language";

import {
	buildQueryEngineField,
	createAuthenticatedClient,
	createEntitySchema,
	createEventSchema,
	createQueryEngineEntity,
	createQueryEngineEvent,
	createSingleSchemaQueryEngineFixture,
	createTracker,
	executeQueryEngine,
	getQueryEngineFieldValue,
	listEventSchemas,
	literalExpression,
} from "../fixtures";
import { assertPresent } from "../test-support/assertions";

describe("events mode", () => {
	it("returns events as primary rows with mode discriminant and pagination metadata", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { trackerId } = await createTracker(client, cookies, {
			name: "Events E2E Tracker",
		});
		const minimalSchema = {
			fields: {
				title: {
					label: "Title",
					description: "Title",
					type: "string" as const,
				},
			},
		};
		const schema = await createEntitySchema(client, cookies, {
			trackerId,
			name: "WatchItem",
			propertiesSchema: minimalSchema,
		});
		const watchSchema = await createEventSchema(client, cookies, {
			name: "Watch",
			slug: "watch",
			entitySchemaId: schema.schemaId,
			propertiesSchema: {
				fields: {
					note: {
						label: "Note",
						description: "Note",
						type: "string" as const,
					},
				},
			},
		});
		const entityId = await createQueryEngineEntity({
			client,
			cookies,
			properties: {},
			name: "My Movie",
			entitySchemaId: schema.schemaId,
		});
		await createQueryEngineEvent({
			client,
			cookies,
			entityId,
			properties: {},
			eventSchemaId: watchSchema.id,
		});
		await createQueryEngineEvent({
			client,
			cookies,
			entityId,
			properties: {},
			eventSchemaId: watchSchema.id,
		});

		const { data, response } = await client.POST("/query-engine/execute", {
			headers: { Cookie: cookies },
			body: {
				filter: null,
				mode: "events",
				eventJoins: [],
				computedFields: [],
				scope: [schema.slug],
				eventSchemas: [watchSchema.slug],
				pagination: { page: 1, limit: 10 },
				sort: {
					direction: "asc",
					expression: {
						type: "reference",
						reference: { type: "event", path: ["createdAt"] },
					},
				},
				fields: [
					{
						key: "eventId",
						expression: {
							type: "reference",
							reference: { type: "event", path: ["id"] },
						},
					},
				],
			},
		});

		expect(response.status).toBe(200);
		expect(data?.mode).toBe("events");
		const result = data?.mode === "events" ? data.data : undefined;
		expect(result?.items).toHaveLength(2);
		expect(result?.meta.pagination.total).toBe(2);
		expect(result?.meta.pagination.hasNextPage).toBe(false);
		expect(result?.meta.fieldOrder).toEqual(["eventId"]);
		for (const item of result?.items ?? []) {
			expect(typeof getQueryEngineFieldValue(item, "eventId")).toBe("string");
		}
	});

	it("returns only events from the specified eventSchemas", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { trackerId } = await createTracker(client, cookies, {
			name: "Events Schema Filter Tracker",
		});
		const minimalSchema = {
			fields: {
				title: {
					label: "Title",
					description: "Title",
					type: "string" as const,
				},
			},
		};
		const schema = await createEntitySchema(client, cookies, {
			trackerId,
			name: "SchemaFilterItem",
			propertiesSchema: minimalSchema,
		});
		const watchSchema = await createEventSchema(client, cookies, {
			name: "Watch",
			slug: "watch",
			entitySchemaId: schema.schemaId,
			propertiesSchema: minimalSchema,
		});
		const reviewSchema = await createEventSchema(client, cookies, {
			name: "Review",
			slug: "review",
			entitySchemaId: schema.schemaId,
			propertiesSchema: minimalSchema,
		});
		const entityId = await createQueryEngineEntity({
			client,
			cookies,
			name: "Filtered Entity",
			entitySchemaId: schema.schemaId,
			properties: {},
		});
		await createQueryEngineEvent({
			client,
			cookies,
			entityId,
			properties: {},
			eventSchemaId: watchSchema.id,
		});
		await createQueryEngineEvent({
			client,
			cookies,
			entityId,
			properties: {},
			eventSchemaId: reviewSchema.id,
		});

		const { data, response } = await client.POST("/query-engine/execute", {
			headers: { Cookie: cookies },
			body: {
				filter: null,
				mode: "events",
				eventJoins: [],
				computedFields: [],
				scope: [schema.slug],
				eventSchemas: [watchSchema.slug],
				pagination: { page: 1, limit: 10 },
				sort: {
					direction: "asc",
					expression: {
						type: "reference",
						reference: { type: "event", path: ["createdAt"] },
					},
				},
				fields: [
					{
						key: "schemaSlug",
						expression: {
							type: "reference",
							reference: { type: "event-schema", path: ["slug"] },
						},
					},
				],
			},
		});

		expect(response.status).toBe(200);
		const result = data?.mode === "events" ? data.data : undefined;
		expect(result?.items).toHaveLength(1);
		expect(getQueryEngineFieldValue(result?.items[0], "schemaSlug")).toBe(watchSchema.slug);
	});

	it("sorts events by a numeric event property expression", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { trackerId } = await createTracker(client, cookies, {
			name: "Events Sort Tracker",
		});
		const schema = await createEntitySchema(client, cookies, {
			trackerId,
			name: "SortItem",
			propertiesSchema: {
				fields: {
					title: {
						label: "Title",
						description: "Title",
						type: "string" as const,
					},
				},
			},
		});
		const reviewSchema = await createEventSchema(client, cookies, {
			name: "Review",
			slug: "review",
			entitySchemaId: schema.schemaId,
			propertiesSchema: {
				fields: {
					rating: {
						label: "Rating",
						description: "Rating",
						type: "integer" as const,
					},
				},
			},
		});
		const entityId = await createQueryEngineEntity({
			client,
			cookies,
			properties: {},
			name: "Sort Entity",
			entitySchemaId: schema.schemaId,
		});
		await createQueryEngineEvent({
			client,
			cookies,
			entityId,
			properties: { rating: 3 },
			eventSchemaId: reviewSchema.id,
		});
		await createQueryEngineEvent({
			client,
			cookies,
			entityId,
			properties: { rating: 1 },
			eventSchemaId: reviewSchema.id,
		});
		await createQueryEngineEvent({
			client,
			cookies,
			entityId,
			properties: { rating: 5 },
			eventSchemaId: reviewSchema.id,
		});

		const { data, response } = await client.POST("/query-engine/execute", {
			headers: { Cookie: cookies },
			body: {
				filter: null,
				mode: "events",
				eventJoins: [],
				computedFields: [],
				scope: [schema.slug],
				eventSchemas: [reviewSchema.slug],
				pagination: { page: 1, limit: 10 },
				sort: {
					direction: "desc",
					expression: {
						type: "reference",
						reference: {
							type: "event",
							path: ["properties", "rating"],
							eventSchemaSlug: reviewSchema.slug,
						},
					},
				},
				fields: [
					{
						key: "rating",
						expression: {
							type: "reference",
							reference: {
								type: "event",
								path: ["properties", "rating"],
								eventSchemaSlug: reviewSchema.slug,
							},
						},
					},
				],
			},
		});

		expect(response.status).toBe(200);
		const items = data?.mode === "events" ? data.data.items : [];
		expect(items).toHaveLength(3);
		const ratings = items.map((item) => getQueryEngineFieldValue(item, "rating"));
		expect(ratings).toEqual([5, 3, 1]);
	});

	it("returns entity name and event schema slug alongside events", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { trackerId } = await createTracker(client, cookies, {
			name: "Events Refs Tracker",
		});
		const schema = await createEntitySchema(client, cookies, {
			trackerId,
			name: "RefsItem",
			propertiesSchema: {
				fields: {
					title: {
						label: "Title",
						description: "Title",
						type: "string" as const,
					},
				},
			},
		});
		const reviewSchema = await createEventSchema(client, cookies, {
			name: "Review",
			slug: "review",
			entitySchemaId: schema.schemaId,
			propertiesSchema: {
				fields: {
					rating: {
						label: "Rating",
						description: "Rating",
						type: "integer" as const,
					},
				},
			},
		});
		const entityId = await createQueryEngineEntity({
			client,
			cookies,
			properties: {},
			name: "Named Entity",
			entitySchemaId: schema.schemaId,
		});
		await createQueryEngineEvent({
			client,
			cookies,
			entityId,
			properties: { rating: 4 },
			eventSchemaId: reviewSchema.id,
		});

		const { data, response } = await client.POST("/query-engine/execute", {
			headers: { Cookie: cookies },
			body: {
				filter: null,
				mode: "events",
				eventJoins: [],
				computedFields: [],
				scope: [schema.slug],
				eventSchemas: [reviewSchema.slug],
				pagination: { page: 1, limit: 10 },
				sort: {
					direction: "asc",
					expression: {
						type: "reference",
						reference: { type: "event", path: ["createdAt"] },
					},
				},
				fields: [
					{
						key: "entityName",
						expression: {
							type: "reference",
							reference: {
								type: "entity",
								path: ["name"],
								slug: schema.slug,
							},
						},
					},
					{
						key: "eventSchemaSlug",
						expression: {
							type: "reference",
							reference: { type: "event-schema", path: ["slug"] },
						},
					},
					{
						key: "rating",
						expression: {
							type: "reference",
							reference: {
								type: "event",
								path: ["properties", "rating"],
								eventSchemaSlug: reviewSchema.slug,
							},
						},
					},
				],
			},
		});

		expect(response.status).toBe(200);
		const items = data?.mode === "events" ? data.data.items : [];
		expect(items).toHaveLength(1);
		const firstItem = items[0] ?? {};
		expect(getQueryEngineFieldValue(firstItem, "entityName")).toBe("Named Entity");
		expect(getQueryEngineFieldValue(firstItem, "eventSchemaSlug")).toBe(reviewSchema.slug);
		expect(getQueryEngineFieldValue(firstItem, "rating")).toBe(4);
	});

	it("returns correct paginated results and metadata in events mode", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { trackerId } = await createTracker(client, cookies, {
			name: "Events Pagination Tracker",
		});
		const schema = await createEntitySchema(client, cookies, {
			trackerId,
			name: "PaginationItem",
			propertiesSchema: {
				fields: {
					title: {
						label: "Title",
						description: "Title",
						type: "string" as const,
					},
				},
			},
		});
		const watchSchema = await createEventSchema(client, cookies, {
			name: "Watch",
			slug: "watch",
			entitySchemaId: schema.schemaId,
			propertiesSchema: {
				fields: {
					seq: { label: "Seq", description: "Seq", type: "integer" as const },
				},
			},
		});
		const entityId = await createQueryEngineEntity({
			client,
			cookies,
			name: "Pagination Entity",
			entitySchemaId: schema.schemaId,
			properties: {},
		});
		for (const seq of [1, 2, 3, 4, 5]) {
			// oxlint-disable-next-line no-await-in-loop
			await createQueryEngineEvent({
				client,
				cookies,
				entityId,
				properties: { seq },
				eventSchemaId: watchSchema.id,
			});
		}

		const sortExpr = {
			direction: "asc" as const,
			expression: {
				type: "reference" as const,
				reference: {
					type: "event" as const,
					path: ["properties", "seq"],
					eventSchemaSlug: watchSchema.slug,
				},
			},
		};
		const fields = [
			{
				key: "seq",
				expression: {
					type: "reference" as const,
					reference: {
						type: "event" as const,
						path: ["properties", "seq"],
						eventSchemaSlug: watchSchema.slug,
					},
				},
			},
		];

		const page1 = await client.POST("/query-engine/execute", {
			headers: { Cookie: cookies },
			body: {
				fields,
				filter: null,
				sort: sortExpr,
				mode: "events",
				eventJoins: [],
				computedFields: [],
				scope: [schema.slug],
				eventSchemas: [watchSchema.slug],
				pagination: { page: 1, limit: 2 },
			},
		});
		const page3 = await client.POST("/query-engine/execute", {
			headers: { Cookie: cookies },
			body: {
				fields,
				filter: null,
				mode: "events",
				eventJoins: [],
				sort: sortExpr,
				computedFields: [],
				scope: [schema.slug],
				eventSchemas: [watchSchema.slug],
				pagination: { page: 3, limit: 2 },
			},
		});

		const result1 = page1.data?.mode === "events" ? page1.data.data : undefined;
		const result3 = page3.data?.mode === "events" ? page3.data.data : undefined;

		expect(page1.response.status).toBe(200);
		expect(result1?.items).toHaveLength(2);
		expect(result1?.meta.pagination).toEqual({
			page: 1,
			total: 5,
			limit: 2,
			totalPages: 3,
			hasNextPage: true,
			hasPreviousPage: false,
		});
		expect(getQueryEngineFieldValue(result1?.items[0], "seq")).toBe(1);

		expect(page3.response.status).toBe(200);
		expect(result3?.items).toHaveLength(1);
		expect(result3?.meta.pagination).toEqual({
			page: 3,
			total: 5,
			limit: 2,
			totalPages: 3,
			hasNextPage: false,
			hasPreviousPage: true,
		});
		expect(getQueryEngineFieldValue(result3?.items[0], "seq")).toBe(5);
	});

	it("attaches event-join data to each event row via a lateral join", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { trackerId } = await createTracker(client, cookies, {
			name: "Events Join Tracker",
		});
		const schema = await createEntitySchema(client, cookies, {
			trackerId,
			name: "JoinItem",
			propertiesSchema: {
				fields: {
					title: {
						label: "Title",
						description: "Title",
						type: "string" as const,
					},
				},
			},
		});
		const watchSchema = await createEventSchema(client, cookies, {
			name: "Watch",
			slug: "watch",
			entitySchemaId: schema.schemaId,
			propertiesSchema: {
				fields: {
					note: {
						label: "Note",
						description: "Note",
						type: "string" as const,
					},
				},
			},
		});
		const reviewSchema = await createEventSchema(client, cookies, {
			name: "Review",
			slug: "review",
			entitySchemaId: schema.schemaId,
			propertiesSchema: {
				fields: {
					rating: {
						label: "Rating",
						description: "Rating",
						type: "integer" as const,
					},
				},
			},
		});
		const entityId = await createQueryEngineEntity({
			client,
			cookies,
			properties: {},
			name: "Join Entity",
			entitySchemaId: schema.schemaId,
		});
		await createQueryEngineEvent({
			client,
			cookies,
			entityId,
			eventSchemaId: watchSchema.id,
			properties: { note: "first watch" },
		});
		await createQueryEngineEvent({
			client,
			cookies,
			entityId,
			eventSchemaId: watchSchema.id,
			properties: { note: "second watch" },
		});
		await createQueryEngineEvent({
			client,
			cookies,
			entityId,
			properties: { rating: 7 },
			eventSchemaId: reviewSchema.id,
		});

		const reviewEventSchemas = await listEventSchemas(client, cookies, schema.schemaId);
		const reviewEventSchema = reviewEventSchemas.find((s) => s.slug === reviewSchema.slug);
		assertPresent(reviewEventSchema, "Review event schema not found");

		const { data, response } = await client.POST("/query-engine/execute", {
			headers: { Cookie: cookies },
			body: {
				filter: null,
				mode: "events",
				computedFields: [],
				scope: [schema.slug],
				eventSchemas: [watchSchema.slug],
				pagination: { page: 1, limit: 10 },
				sort: {
					direction: "asc",
					expression: {
						type: "reference",
						reference: { type: "event", path: ["createdAt"] },
					},
				},
				eventJoins: [
					{
						key: "review",
						kind: "latestEvent",
						eventSchemaSlug: reviewSchema.slug,
					},
				],
				fields: [
					{
						key: "latestRating",
						expression: {
							type: "reference",
							reference: {
								joinKey: "review",
								type: "event-join",
								path: ["properties", "rating"],
							},
						},
					},
				],
			},
		});

		expect(response.status).toBe(200);
		const items = data?.mode === "events" ? data.data.items : [];
		// Both watch events should have the latest review rating attached
		expect(items).toHaveLength(2);
		for (const item of items) {
			expect(getQueryEngineFieldValue(item, "latestRating")).toBe(7);
		}
	});

	it("filters events by an event property predicate before returning rows", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { trackerId } = await createTracker(client, cookies, {
			name: "Events Filter Tracker",
		});
		const schema = await createEntitySchema(client, cookies, {
			trackerId,
			name: "FilterModeItem",
			propertiesSchema: {
				fields: {
					title: {
						label: "Title",
						description: "Title",
						type: "string" as const,
					},
				},
			},
		});
		const reviewSchema = await createEventSchema(client, cookies, {
			name: "Review",
			slug: "review",
			entitySchemaId: schema.schemaId,
			propertiesSchema: {
				fields: {
					rating: {
						label: "Rating",
						description: "Rating",
						type: "integer" as const,
					},
				},
			},
		});
		const entityId = await createQueryEngineEntity({
			client,
			cookies,
			name: "Filter Mode Entity",
			entitySchemaId: schema.schemaId,
			properties: {},
		});
		for (const rating of [1, 2, 3, 4, 5]) {
			// oxlint-disable-next-line no-await-in-loop
			await createQueryEngineEvent({
				client,
				cookies,
				entityId,
				properties: { rating },
				eventSchemaId: reviewSchema.id,
			});
		}

		const ratingRef = {
			type: "reference" as const,
			reference: {
				type: "event" as const,
				path: ["properties", "rating"],
				eventSchemaSlug: reviewSchema.slug,
			},
		};

		const { data, response } = await client.POST("/query-engine/execute", {
			headers: { Cookie: cookies },
			body: {
				mode: "events",
				eventJoins: [],
				computedFields: [],
				scope: [schema.slug],
				eventSchemas: [reviewSchema.slug],
				pagination: { page: 1, limit: 10 },
				sort: { direction: "asc", expression: ratingRef },
				fields: [{ key: "rating", expression: ratingRef }],
				filter: {
					operator: "gte",
					left: ratingRef,
					type: "comparison",
					right: literalExpression(4),
				},
			},
		});

		expect(response.status).toBe(200);
		const items = data?.mode === "events" ? data.data.items : [];
		expect(items).toHaveLength(2);
		const ratings = items.map((item) => getQueryEngineFieldValue(item, "rating"));
		expect(ratings).toEqual([4, 5]);
	});

	it("rejects event-aggregate references in events mode", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { trackerId } = await createTracker(client, cookies, {
			name: "Events Ref Rejection Tracker",
		});
		const schema = await createEntitySchema(client, cookies, {
			trackerId,
			name: "RefRejectionItem",
			propertiesSchema: {
				fields: {
					title: {
						label: "Title",
						description: "Title",
						type: "string" as const,
					},
				},
			},
		});
		const reviewSchema = await createEventSchema(client, cookies, {
			name: "Review",
			slug: "review",
			entitySchemaId: schema.schemaId,
			propertiesSchema: {
				fields: {
					rating: {
						label: "Rating",
						description: "Rating",
						type: "integer" as const,
					},
				},
			},
		});

		const { error, response } = await client.POST("/query-engine/execute", {
			headers: { Cookie: cookies },
			body: {
				filter: null,
				mode: "events",
				eventJoins: [],
				computedFields: [],
				scope: [schema.slug],
				eventSchemas: [reviewSchema.slug],
				pagination: { page: 1, limit: 10 },
				sort: {
					direction: "asc",
					expression: {
						type: "reference",
						reference: { type: "event", path: ["createdAt"] },
					},
				},
				fields: [
					{
						key: "avgRating",
						expression: {
							type: "reference",
							reference: {
								aggregation: "avg",
								type: "event-aggregate",
								path: ["properties", "rating"],
								eventSchemaSlug: reviewSchema.slug,
							},
						},
					},
				],
			},
		});

		expect(response.status).toBe(400);
		expect(error?.error.message).toBe(
			"event-aggregate references are not supported in this query mode",
		);
	});

	it("rejects a missing event-join reference in events mode", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { trackerId } = await createTracker(client, cookies, {
			name: "Events Join Ref Reject Tracker",
		});
		const schema = await createEntitySchema(client, cookies, {
			trackerId,
			name: "JoinRefRejectItem",
			propertiesSchema: {
				fields: {
					title: {
						label: "Title",
						description: "Title",
						type: "string" as const,
					},
				},
			},
		});
		const watchSchema = await createEventSchema(client, cookies, {
			name: "Watch",
			slug: "watch",
			entitySchemaId: schema.schemaId,
			propertiesSchema: {
				fields: {
					note: {
						label: "Note",
						description: "Note",
						type: "string" as const,
					},
				},
			},
		});

		const { error, response } = await client.POST("/query-engine/execute", {
			headers: { Cookie: cookies },
			body: {
				filter: null,
				mode: "events",
				eventJoins: [],
				computedFields: [],
				scope: [schema.slug],
				pagination: { page: 1, limit: 10 },
				eventSchemas: [watchSchema.slug],
				sort: {
					direction: "asc",
					expression: {
						type: "reference",
						reference: { type: "event", path: ["createdAt"] },
					},
				},
				fields: [
					{
						key: "reviewRating",
						expression: {
							type: "reference",
							reference: {
								type: "event-join",
								joinKey: "review",
								path: ["properties", "rating"],
							},
						},
					},
				],
			},
		});

		expect(response.status).toBe(400);
		expect(error?.error.message).toBe(
			"Event join 'event.review' is not part of this runtime request",
		);
	});

	it("rejects primary event references in entities mode", async () => {
		const { client, cookies, schema } = await createSingleSchemaQueryEngineFixture();

		const { error, response } = await executeQueryEngine(client, cookies, {
			eventJoins: [],
			scope: [schema.slug],
			pagination: { page: 1, limit: 1 },
			sort: {
				direction: "asc",
				expression: createEntityColumnExpression(schema.slug, "name"),
			},
			fields: [
				buildQueryEngineField("eventCreatedAt", {
					type: "reference",
					reference: { type: "event", path: ["createdAt"] },
				}),
			],
		});

		expect(response.status).toBe(400);
		expect(error?.error.message).toBe(
			"Primary event references are not supported in this query mode",
		);
	});

	it("rejects primary event property sort expressions without eventSchemaSlug in events mode", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { trackerId } = await createTracker(client, cookies, {
			name: "Primary Event Schema Slug Tracker",
		});
		const schema = await createEntitySchema(client, cookies, {
			trackerId,
			name: "StrictEventProps",
			propertiesSchema: {
				fields: {
					title: {
						label: "Title",
						description: "Title",
						type: "string" as const,
					},
				},
			},
		});
		const reviewSchema = await createEventSchema(client, cookies, {
			name: "Review",
			slug: "review",
			entitySchemaId: schema.schemaId,
			propertiesSchema: {
				fields: {
					rating: {
						label: "Rating",
						description: "Rating",
						type: "integer" as const,
					},
				},
			},
		});
		const entityId = await createQueryEngineEntity({
			client,
			cookies,
			name: "Strict Event Entity",
			entitySchemaId: schema.schemaId,
			properties: {},
		});
		await createQueryEngineEvent({
			client,
			cookies,
			entityId,
			eventSchemaId: reviewSchema.id,
			properties: { rating: 5 },
		});

		const { error, response } = await client.POST("/query-engine/execute", {
			headers: { Cookie: cookies },
			body: {
				filter: null,
				mode: "events",
				eventJoins: [],
				computedFields: [],
				scope: [schema.slug],
				eventSchemas: [reviewSchema.slug],
				pagination: { page: 1, limit: 10 },
				sort: {
					direction: "asc",
					expression: {
						type: "reference",
						reference: {
							type: "event",
							path: ["properties", "rating"],
						},
					},
				},
				fields: [],
			},
		});

		expect(response.status).toBe(400);
		expect(error?.error.message).toBe(
			"Primary event property references in this context must specify eventSchemaSlug",
		);
	});
});
