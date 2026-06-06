import { describe, expect, it } from "bun:test";

import { DateTime, Duration } from "effect";

import {
	createAuthenticatedClient,
	createEntitySchema,
	createEventSchema,
	createQueryEngineEntity,
	createQueryEngineEvent,
	createTracker,
	literalExpression,
} from "../fixtures";

const currentTime = () => DateTime.unsafeNow();
const startOfDay = (value = currentTime()) => DateTime.startOf(value, "day");
const add = (
	value: ReturnType<typeof currentTime>,
	duration: Parameters<typeof DateTime.addDuration>[1],
) => DateTime.addDuration(value, duration);
const toIso = (value: ReturnType<typeof currentTime>) => DateTime.formatIso(value);

describe("time-series mode", () => {
	it("returns day buckets with correct event counts and fills empty buckets with 0", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { trackerId } = await createTracker(client, cookies, {
			name: "TimeSeries Tracker",
		});
		const minimalPropertiesSchema = {
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
			name: "TSItem",
			propertiesSchema: minimalPropertiesSchema,
		});
		const reviewSchema = await createEventSchema(client, cookies, {
			name: "Review",
			slug: "review",
			entitySchemaId: schema.schemaId,
			propertiesSchema: minimalPropertiesSchema,
		});
		const entityId = await createQueryEngineEntity({
			client,
			cookies,
			properties: {},
			name: "TS Entity",
			entitySchemaId: schema.schemaId,
		});

		// Create 2 events now. They will fall in today's bucket.
		await createQueryEngineEvent({
			client,
			cookies,
			entityId,
			properties: {},
			eventSchemaId: reviewSchema.id,
		});
		await createQueryEngineEvent({
			client,
			cookies,
			entityId,
			properties: {},
			eventSchemaId: reviewSchema.id,
		});

		// Date range: today UTC to today+3 days UTC (3 day buckets)
		const startAt = toIso(startOfDay());
		const endAt = toIso(add(startOfDay(), "3 days"));

		const { data, response } = await client.queryEngine.execute({
			headers: { Cookie: cookies },
			body: {
				filter: null,
				bucket: "day",
				mode: "timeSeries",
				computedFields: [],
				scope: [schema.slug],
				metric: { type: "count" },
				dateRange: { startAt, endAt },
				eventSchemas: [reviewSchema.slug],
			},
		});

		expect(response.status).toBe(200);
		expect(data?.mode).toBe("timeSeries");
		const buckets = data?.mode === "timeSeries" ? data.data.buckets : [];
		expect(buckets).toHaveLength(3);
		expect(buckets[0]?.value).toBe(2);
		// Future buckets should be 0 (empty bucket fill)
		expect(buckets[1]?.value).toBe(0);
		expect(buckets[2]?.value).toBe(0);
		expect(typeof buckets[0]?.date).toBe("string");
	});

	it("returns timeSeries mode discriminant in response", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { trackerId } = await createTracker(client, cookies, {
			name: "TimeSeries Mode Check",
		});
		const minimalPropertiesSchema = {
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
			name: "ModeCheckItem",
			propertiesSchema: minimalPropertiesSchema,
		});
		const reviewSchema = await createEventSchema(client, cookies, {
			name: "Review",
			slug: "review",
			entitySchemaId: schema.schemaId,
			propertiesSchema: minimalPropertiesSchema,
		});

		const startAt = toIso(startOfDay());
		const endAt = toIso(add(startOfDay(), Duration.days(1)));

		const { data, response } = await client.queryEngine.execute({
			headers: { Cookie: cookies },
			body: {
				filter: null,
				bucket: "hour",
				mode: "timeSeries",
				computedFields: [],
				scope: [schema.slug],
				metric: { type: "count" },
				dateRange: { startAt, endAt },
				eventSchemas: [reviewSchema.slug],
			},
		});

		expect(response.status).toBe(200);
		expect(data?.mode).toBe("timeSeries");
		const buckets = data?.mode === "timeSeries" ? data.data.buckets : [];
		expect(buckets).toHaveLength(24);
	});

	it("rejects requests where startAt is not before endAt", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { trackerId } = await createTracker(client, cookies, {
			name: "TimeSeries DateRange Check",
		});
		const minimalPropertiesSchema = {
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
			name: "DateRangeItem",
			propertiesSchema: minimalPropertiesSchema,
		});
		const reviewSchema = await createEventSchema(client, cookies, {
			name: "Review",
			slug: "review",
			entitySchemaId: schema.schemaId,
			propertiesSchema: minimalPropertiesSchema,
		});

		const currentIso = toIso(currentTime());

		const { response } = await client.queryEngine.execute({
			headers: { Cookie: cookies },
			body: {
				filter: null,
				bucket: "day",
				mode: "timeSeries",
				computedFields: [],
				scope: [schema.slug],
				metric: { type: "count" },
				eventSchemas: [reviewSchema.slug],
				// endAt before startAt
				dateRange: { startAt: currentIso, endAt: currentIso },
			},
		});

		expect(response.status).toBe(400);
	});

	it("returns zero for a partial bucket range that excludes the event", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { trackerId } = await createTracker(client, cookies, {
			name: "TimeSeries Single Bucket",
		});
		const minimalPropertiesSchema = {
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
			name: "SingleBucketItem",
			propertiesSchema: minimalPropertiesSchema,
		});
		const reviewSchema = await createEventSchema(client, cookies, {
			name: "Review",
			slug: "review",
			entitySchemaId: schema.schemaId,
			propertiesSchema: minimalPropertiesSchema,
		});
		const entityId = await createQueryEngineEntity({
			client,
			cookies,
			properties: {},
			name: "Single Bucket Entity",
			entitySchemaId: schema.schemaId,
		});

		await createQueryEngineEvent({
			client,
			cookies,
			entityId,
			properties: {},
			eventSchemaId: reviewSchema.id,
		});

		const futureDay = currentTime().pipe(
			(value) => DateTime.addDuration(value, Duration.days(365)),
			DateTime.startOf("day"),
		);
		const startAt = toIso(add(futureDay, "10 hours"));
		const endAt = toIso(add(futureDay, "12 hours"));

		const { data, response } = await client.queryEngine.execute({
			headers: { Cookie: cookies },
			body: {
				filter: null,
				bucket: "day",
				mode: "timeSeries",
				computedFields: [],
				scope: [schema.slug],
				metric: { type: "count" },
				dateRange: { startAt, endAt },
				eventSchemas: [reviewSchema.slug],
			},
		});

		expect(response.status).toBe(200);
		const buckets = data?.mode === "timeSeries" ? data.data.buckets : [];
		expect(buckets).toHaveLength(1);
		expect(buckets[0]?.value).toBe(0);
	});

	it("filters by occurredAt not createdAt when applying dateRange", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { trackerId } = await createTracker(client, cookies, {
			name: "TimeSeries OccurredAt Filter",
		});
		const minimalSchema = {
			fields: { title: { type: "string" as const, label: "Title", description: "Title" } },
		};
		const schema = await createEntitySchema(client, cookies, {
			trackerId,
			name: "OccurredAtItem",
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
			properties: {},
			name: "OccurredAt Entity",
			entitySchemaId: schema.schemaId,
		});

		// This event's createdAt is now, but occurredAt is set 1 year in the past.
		// A dateRange covering today should exclude it when filtering by occurredAt.
		const pastOccurredAt = currentTime().pipe(
			(value) => DateTime.addDuration(value, Duration.days(-365)),
			DateTime.startOf("day"),
			DateTime.formatIso,
		);
		await createQueryEngineEvent({
			client,
			cookies,
			entityId,
			properties: {},
			occurredAt: pastOccurredAt,
			eventSchemaId: reviewSchema.id,
		});

		// This event has no explicit occurredAt so it defaults to now.
		// It should be included in today's dateRange.
		await createQueryEngineEvent({
			client,
			cookies,
			entityId,
			properties: {},
			eventSchemaId: reviewSchema.id,
		});

		const startAt = toIso(startOfDay());
		const endAt = toIso(add(startOfDay(), Duration.days(1)));

		const { data, response } = await client.queryEngine.execute({
			headers: { Cookie: cookies },
			body: {
				filter: null,
				bucket: "day",
				mode: "timeSeries",
				computedFields: [],
				scope: [schema.slug],
				metric: { type: "count" },
				dateRange: { startAt, endAt },
				eventSchemas: [reviewSchema.slug],
			},
		});

		expect(response.status).toBe(200);
		const buckets = data?.mode === "timeSeries" ? data.data.buckets : [];
		// Only the event with occurredAt = now falls in today's range.
		// If the filter used createdAt, it would count 2 (both were just inserted).
		expect(buckets).toHaveLength(1);
		expect(buckets[0]?.value).toBe(1);
	});

	it("counts explicit occurredAt in the matching past bucket", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { trackerId } = await createTracker(client, cookies, {
			name: "TimeSeries OccurredAt Bucket",
		});
		const minimalSchema = {
			fields: { title: { type: "string" as const, label: "Title", description: "Title" } },
		};
		const schema = await createEntitySchema(client, cookies, {
			trackerId,
			name: "OccurredAtBucketItem",
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
			properties: {},
			name: "OccurredAt Bucket Entity",
			entitySchemaId: schema.schemaId,
		});

		const pastBucketStart = currentTime().pipe(
			(value) => DateTime.addDuration(value, Duration.days(-365)),
			DateTime.startOf("day"),
		);
		await createQueryEngineEvent({
			client,
			cookies,
			entityId,
			properties: {},
			eventSchemaId: reviewSchema.id,
			occurredAt: toIso(pastBucketStart),
		});

		const startAt = toIso(pastBucketStart);
		const endAt = toIso(add(pastBucketStart, Duration.days(1)));

		const { data, response } = await client.queryEngine.execute({
			headers: { Cookie: cookies },
			body: {
				filter: null,
				bucket: "day",
				mode: "timeSeries",
				computedFields: [],
				scope: [schema.slug],
				metric: { type: "count" },
				dateRange: { startAt, endAt },
				eventSchemas: [reviewSchema.slug],
			},
		});

		expect(response.status).toBe(200);
		const buckets = data?.mode === "timeSeries" ? data.data.buckets : [];
		expect(buckets).toHaveLength(1);
		expect(buckets[0]?.date).toBe(startAt);
		expect(buckets[0]?.value).toBe(1);
	});

	it("filters events before bucketing with an event property filter", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { trackerId } = await createTracker(client, cookies, {
			name: "TimeSeries Filter Tracker",
		});
		const minimalPropertiesSchema = {
			fields: { title: { label: "Title", description: "Title", type: "string" as const } },
		};
		const schema = await createEntitySchema(client, cookies, {
			trackerId,
			name: "FilterItem",
			propertiesSchema: minimalPropertiesSchema,
		});
		const reviewSchema = await createEventSchema(client, cookies, {
			name: "Review",
			slug: "review",
			entitySchemaId: schema.schemaId,
			propertiesSchema: {
				fields: { rating: { type: "integer", label: "Rating", description: "Rating" } },
			},
		});
		const entityId = await createQueryEngineEntity({
			client,
			cookies,
			properties: {},
			name: "Filter Entity",
			entitySchemaId: schema.schemaId,
		});

		// Create 3 events: 2 with rating=5, 1 with rating=3
		await createQueryEngineEvent({
			client,
			cookies,
			entityId,
			properties: { rating: 5 },
			eventSchemaId: reviewSchema.id,
		});
		await createQueryEngineEvent({
			client,
			cookies,
			entityId,
			properties: { rating: 5 },
			eventSchemaId: reviewSchema.id,
		});
		await createQueryEngineEvent({
			client,
			cookies,
			entityId,
			properties: { rating: 3 },
			eventSchemaId: reviewSchema.id,
		});

		const startAt = toIso(startOfDay());
		const endAt = toIso(add(startOfDay(), Duration.days(1)));

		const { data, response } = await client.queryEngine.execute({
			headers: { Cookie: cookies },
			body: {
				bucket: "day",
				mode: "timeSeries",
				computedFields: [],
				scope: [schema.slug],
				metric: { type: "count" },
				dateRange: { startAt, endAt },
				eventSchemas: [reviewSchema.slug],
				filter: {
					operator: "gte",
					type: "comparison",
					right: literalExpression(5),
					left: {
						type: "reference",
						reference: {
							type: "event",
							path: ["properties", "rating"],
							eventSchemaSlug: reviewSchema.slug,
						},
					},
				},
			},
		});

		expect(response.status).toBe(200);
		const buckets = data?.mode === "timeSeries" ? data.data.buckets : [];
		// Only the 2 events with rating >= 5 should be counted
		expect(buckets[0]?.value).toBe(2);
	});

	it("rejects event-join references in time-series mode", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { trackerId } = await createTracker(client, cookies, {
			name: "TimeSeries Ref Rejection",
		});
		const minimalPropertiesSchema = {
			fields: { title: { label: "Title", description: "Title", type: "string" as const } },
		};
		const schema = await createEntitySchema(client, cookies, {
			trackerId,
			name: "RefRejection",
			propertiesSchema: minimalPropertiesSchema,
		});
		const reviewSchema = await createEventSchema(client, cookies, {
			name: "Review",
			slug: "review",
			entitySchemaId: schema.schemaId,
			propertiesSchema: minimalPropertiesSchema,
		});

		const startAt = toIso(startOfDay());
		const endAt = toIso(add(startOfDay(), Duration.days(1)));

		const { error, response } = await client.queryEngine.execute({
			headers: { Cookie: cookies },
			body: {
				filter: null,
				bucket: "day",
				mode: "timeSeries",
				computedFields: [],
				scope: [schema.slug],
				dateRange: { startAt, endAt },
				eventSchemas: [reviewSchema.slug],
				metric: {
					type: "sum",
					expression: {
						type: "reference",
						reference: { joinKey: "review", type: "event-join", path: ["createdAt"] },
					},
				},
			},
		});

		expect(response.status).toBe(400);
		expect(error?.error.message).toBe(
			"Event join 'event.review' is not part of this runtime request",
		);
	});

	it("rejects non-numeric sum metric expressions", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { trackerId } = await createTracker(client, cookies, {
			name: "TimeSeries Sum Type Rejection",
		});
		const minimalPropertiesSchema = {
			fields: { title: { label: "Title", description: "Title", type: "string" as const } },
		};
		const schema = await createEntitySchema(client, cookies, {
			trackerId,
			name: "SumTypeRejection",
			propertiesSchema: minimalPropertiesSchema,
		});
		const reviewSchema = await createEventSchema(client, cookies, {
			name: "Review",
			slug: "review",
			entitySchemaId: schema.schemaId,
			propertiesSchema: minimalPropertiesSchema,
		});

		const startAt = toIso(startOfDay());
		const endAt = toIso(add(startOfDay(), Duration.days(1)));

		const { response } = await client.queryEngine.execute({
			headers: { Cookie: cookies },
			body: {
				filter: null,
				bucket: "day",
				mode: "timeSeries",
				computedFields: [],
				scope: [schema.slug],
				dateRange: { startAt, endAt },
				eventSchemas: [reviewSchema.slug],
				metric: {
					type: "sum",
					expression: { type: "reference", reference: { type: "event", path: ["createdAt"] } },
				},
			},
		});

		// createdAt is a datetime, not a number
		expect(response.status).toBe(400);
	});
});
