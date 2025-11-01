import { describe, expect, it } from "bun:test";

import { DateTime, Duration } from "effect";

import {
	createAuthenticatedClient,
	createEventSchema,
	createQueryEngineEntity,
	createQueryEngineEvent,
	createQueryEngineTrackerAndSchema,
	executeQueryEngineError,
	executeTimeSeriesQueryEngine,
	propertyRef,
	systemRef,
	type QueryEnginePayload,
} from "../fixtures";
import { assertTaggedError } from "../test-support/assertions";

const currentTime = () => DateTime.unsafeNow();
const startOfDay = (value = currentTime()) => DateTime.startOf(value, "day");
const add = (
	value: ReturnType<typeof currentTime>,
	duration: Parameters<typeof DateTime.addDuration>[1],
) => DateTime.addDuration(value, duration);
const toIso = (value: ReturnType<typeof currentTime>) => DateTime.formatIso(value);

const buildEventTimeSeriesDoc = (input: {
	entityAlias: string;
	eventAlias: string;
	entitySchemas: [string, ...string[]];
	eventSchemas: [string, ...string[]];
	startAt: string;
	endAt: string;
	where?: Extract<QueryEnginePayload["source"], { type: "events" }>["where"];
	bucket?: Extract<QueryEnginePayload["output"], { type: "timeSeries" }>["time"]["bucket"];
	measure?: Extract<QueryEnginePayload["output"], { type: "timeSeries" }>["measure"];
	timeExpr?: Extract<QueryEnginePayload["output"], { type: "timeSeries" }>["time"]["expr"];
}): QueryEnginePayload => ({
	version: 2,
	source: {
		where: input.where ?? null,
		type: "events",
		alias: input.eventAlias,
		schemas: input.eventSchemas,
		entity: { alias: input.entityAlias, schemas: input.entitySchemas },
	},
	output: {
		type: "timeSeries",
		measure: input.measure ?? { aggregation: { function: "count" } },
		time: {
			bucket: input.bucket ?? "day",
			expr: input.timeExpr ?? systemRef(input.eventAlias, "occurredAt"),
			range: { startAt: input.startAt, endAt: input.endAt },
		},
	},
});

describe("event time series", () => {
	it("buckets events by occurredAt rather than createdAt", async () => {
		const { client } = await createAuthenticatedClient();
		const { schemaId, slug } = await createQueryEngineTrackerAndSchema(client, {
			schemaName: "OccurredAtSeriesItem",
		});
		const reviewSlug = `time-series-occurred-${crypto.randomUUID()}`;
		const reviewSchema = await createEventSchema(client, {
			slug: reviewSlug,
			name: "OccurredAt Review",
			entitySchemaId: schemaId,
			propertiesSchema: {
				fields: { note: { type: "string", label: "Note", description: "Note" } },
			},
		});
		const entity = await createQueryEngineEntity(client, {
			name: "OccurredAt Series Entity",
			entitySchemaId: schemaId,
		});

		const pastOccurredAt = currentTime().pipe(
			(value) => DateTime.subtractDuration(value, Duration.days(365)),
			DateTime.startOf("day"),
			DateTime.formatIso,
		);
		await createQueryEngineEvent(client, {
			entityId: entity.id,
			eventSchemaId: reviewSchema.id,
			occurredAt: pastOccurredAt,
		});
		await createQueryEngineEvent(client, {
			entityId: entity.id,
			eventSchemaId: reviewSchema.id,
		});

		const result = await executeTimeSeriesQueryEngine(
			client,
			buildEventTimeSeriesDoc({
				entityAlias: "item",
				eventAlias: "review",
				entitySchemas: [slug],
				eventSchemas: [reviewSlug],
				startAt: toIso(startOfDay()),
				endAt: toIso(add(startOfDay(), Duration.days(1))),
			}),
		);

		expect(result.data.buckets).toHaveLength(1);
		expect(result.data.buckets[0]?.value).toBe(1);
	});

	it("filters events before bucketing with an event property filter", async () => {
		const { client } = await createAuthenticatedClient();
		const { schemaId, slug } = await createQueryEngineTrackerAndSchema(client, {
			schemaName: "TimeSeriesFilterItem",
		});
		const reviewSlug = `time-series-filter-${crypto.randomUUID()}`;
		const reviewSchema = await createEventSchema(client, {
			slug: reviewSlug,
			name: "Time Series Filter Review",
			entitySchemaId: schemaId,
			propertiesSchema: {
				fields: {
					rating: { type: "integer", label: "Rating", description: "Rating" },
				},
			},
		});
		const entity = await createQueryEngineEntity(client, {
			name: "Time Series Filter Entity",
			entitySchemaId: schemaId,
		});

		await Promise.all(
			[5, 5, 3].map((rating) =>
				createQueryEngineEvent(client, {
					entityId: entity.id,
					properties: { rating },
					eventSchemaId: reviewSchema.id,
				}),
			),
		);

		const ratingRef = propertyRef("review", reviewSlug, "rating");
		const result = await executeTimeSeriesQueryEngine(
			client,
			buildEventTimeSeriesDoc({
				entityAlias: "item",
				eventAlias: "review",
				entitySchemas: [slug],
				eventSchemas: [reviewSlug],
				startAt: toIso(startOfDay()),
				endAt: toIso(add(startOfDay(), Duration.days(1))),
				where: {
					left: ratingRef,
					right: { type: "literal", value: 5 },
					type: "comparison",
					operator: "gte",
				},
			}),
		);

		expect(result.data.buckets[0]?.value).toBe(2);
	});

	it("returns zero for a partial range that excludes all events", async () => {
		const { client } = await createAuthenticatedClient();
		const { schemaId, slug } = await createQueryEngineTrackerAndSchema(client, {
			schemaName: "TimeSeriesZeroFillItem",
		});
		const reviewSlug = `time-series-zero-${crypto.randomUUID()}`;
		const reviewSchema = await createEventSchema(client, {
			slug: reviewSlug,
			name: "Time Series Zero Review",
			entitySchemaId: schemaId,
			propertiesSchema: {
				fields: { note: { type: "string", label: "Note", description: "Note" } },
			},
		});
		const entity = await createQueryEngineEntity(client, {
			name: "Time Series Zero Entity",
			entitySchemaId: schemaId,
		});

		await createQueryEngineEvent(client, { entityId: entity.id, eventSchemaId: reviewSchema.id });

		const futureDay = currentTime().pipe(
			(value) => DateTime.addDuration(value, Duration.days(365)),
			DateTime.startOf("day"),
		);
		const result = await executeTimeSeriesQueryEngine(
			client,
			buildEventTimeSeriesDoc({
				entityAlias: "item",
				eventAlias: "review",
				entitySchemas: [slug],
				eventSchemas: [reviewSlug],
				startAt: toIso(add(futureDay, "10 hours")),
				endAt: toIso(add(futureDay, "12 hours")),
			}),
		);

		expect(result.data.buckets).toHaveLength(1);
		expect(result.data.buckets[0]?.value).toBe(0);
	});

	it("rejects time ranges where startAt is not before endAt", async () => {
		const { client } = await createAuthenticatedClient();
		const { schemaId, slug } = await createQueryEngineTrackerAndSchema(client, {
			schemaName: "TimeSeriesRangeItem",
		});
		const reviewSlug = `time-series-range-${crypto.randomUUID()}`;
		await createEventSchema(client, {
			slug: reviewSlug,
			name: "Time Series Range Review",
			entitySchemaId: schemaId,
			propertiesSchema: {
				fields: { note: { type: "string", label: "Note", description: "Note" } },
			},
		});

		const currentIso = toIso(currentTime());
		const error = await executeQueryEngineError(
			client,
			buildEventTimeSeriesDoc({
				entityAlias: "item",
				eventAlias: "review",
				entitySchemas: [slug],
				eventSchemas: [reviewSlug],
				startAt: currentIso,
				endAt: currentIso,
			}),
		);

		assertTaggedError(error, "BadRequest");
	});
});
