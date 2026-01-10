import { DateTime, Duration, Effect } from "effect";

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
} from "~/fixtures";
import { assertTaggedError } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

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
	source: {
		type: "events",
		alias: input.eventAlias,
		where: input.where ?? null,
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
	it.live("buckets events by occurredAt rather than createdAt", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schemaId, slug } = yield* createQueryEngineTrackerAndSchema(client, {
				schemaName: "OccurredAtSeriesItem",
			});
			const reviewSlug = `time-series-occurred-${crypto.randomUUID()}`;
			const reviewSchema = yield* createEventSchema(client, {
				slug: reviewSlug,
				name: "OccurredAt Review",
				entitySchemaId: schemaId,
			});
			const entity = yield* createQueryEngineEntity(client, {
				name: "OccurredAt Series Entity",
				entitySchemaId: schemaId,
			});

			const pastOccurredAt = currentTime().pipe(
				(value) => DateTime.subtractDuration(value, Duration.days(365)),
				DateTime.startOf("day"),
				DateTime.formatIso,
			);
			yield* createQueryEngineEvent(client, {
				entityId: entity.id,
				eventSchemaId: reviewSchema.id,
				occurredAt: pastOccurredAt,
			});
			yield* createQueryEngineEvent(client, {
				entityId: entity.id,
				eventSchemaId: reviewSchema.id,
			});

			const result = yield* executeTimeSeriesQueryEngine(
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
		}),
	);

	it.live("filters events before bucketing with an event property filter", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schemaId, slug } = yield* createQueryEngineTrackerAndSchema(client, {
				schemaName: "TimeSeriesFilterItem",
			});
			const reviewSlug = `time-series-filter-${crypto.randomUUID()}`;
			const reviewSchema = yield* createEventSchema(client, {
				slug: reviewSlug,
				name: "Time Series Filter Review",
				entitySchemaId: schemaId,
				propertiesSchema: {
					fields: {
						rating: { type: "integer", label: "Rating", description: "Rating" },
					},
				},
			});
			const entity = yield* createQueryEngineEntity(client, {
				name: "Time Series Filter Entity",
				entitySchemaId: schemaId,
			});

			yield* Effect.all(
				[5, 5, 3].map((rating) =>
					createQueryEngineEvent(client, {
						entityId: entity.id,
						properties: { rating },
						eventSchemaId: reviewSchema.id,
					}),
				),
			);

			const ratingRef = propertyRef("review", reviewSlug, "rating");
			const result = yield* executeTimeSeriesQueryEngine(
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
		}),
	);

	it.live("returns zero for a partial range that excludes all events", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schemaId, slug } = yield* createQueryEngineTrackerAndSchema(client, {
				schemaName: "TimeSeriesZeroFillItem",
			});
			const reviewSlug = `time-series-zero-${crypto.randomUUID()}`;
			const reviewSchema = yield* createEventSchema(client, {
				slug: reviewSlug,
				name: "Time Series Zero Review",
				entitySchemaId: schemaId,
			});
			const entity = yield* createQueryEngineEntity(client, {
				name: "Time Series Zero Entity",
				entitySchemaId: schemaId,
			});

			yield* createQueryEngineEvent(client, {
				entityId: entity.id,
				eventSchemaId: reviewSchema.id,
			});

			const futureDay = currentTime().pipe(
				(value) => DateTime.addDuration(value, Duration.days(365)),
				DateTime.startOf("day"),
			);
			const result = yield* executeTimeSeriesQueryEngine(
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
		}),
	);

	it.live("zero-fills interior buckets across a multi-day range", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schemaId, slug } = yield* createQueryEngineTrackerAndSchema(client, {
				schemaName: "TimeSeriesGapItem",
			});
			const reviewSlug = `time-series-gap-${crypto.randomUUID()}`;
			const reviewSchema = yield* createEventSchema(client, {
				slug: reviewSlug,
				name: "Time Series Gap Review",
				entitySchemaId: schemaId,
			});
			const entity = yield* createQueryEngineEntity(client, {
				name: "Time Series Gap Entity",
				entitySchemaId: schemaId,
			});

			const base = startOfDay(DateTime.subtractDuration(currentTime(), Duration.days(10)));
			const dayZero = toIso(base);
			const dayTwo = toIso(add(base, Duration.days(2)));
			yield* Effect.all([
				createQueryEngineEvent(client, {
					entityId: entity.id,
					occurredAt: dayZero,
					eventSchemaId: reviewSchema.id,
				}),
				createQueryEngineEvent(client, {
					entityId: entity.id,
					occurredAt: dayZero,
					eventSchemaId: reviewSchema.id,
				}),
				createQueryEngineEvent(client, {
					entityId: entity.id,
					occurredAt: dayTwo,
					eventSchemaId: reviewSchema.id,
				}),
			]);

			const result = yield* executeTimeSeriesQueryEngine(
				client,
				buildEventTimeSeriesDoc({
					entityAlias: "item",
					eventAlias: "review",
					entitySchemas: [slug],
					eventSchemas: [reviewSlug],
					startAt: toIso(base),
					endAt: toIso(add(base, Duration.days(3))),
				}),
			);

			expect(result.data.buckets.map((bucket) => bucket.value)).toEqual([2, 0, 1]);
			expect(result.data.buckets[0]?.endAt).toBe(result.data.buckets[1]?.startAt);
			expect(result.data.buckets[1]?.endAt).toBe(result.data.buckets[2]?.startAt);
		}),
	);

	it.live("aligns week buckets to the ISO Monday start in SQL", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schemaId, slug } = yield* createQueryEngineTrackerAndSchema(client, {
				schemaName: "TimeSeriesWeekItem",
			});
			const reviewSlug = `time-series-week-${crypto.randomUUID()}`;
			const reviewSchema = yield* createEventSchema(client, {
				slug: reviewSlug,
				name: "Time Series Week Review",
				entitySchemaId: schemaId,
			});
			const entity = yield* createQueryEngineEntity(client, {
				name: "Time Series Week Entity",
				entitySchemaId: schemaId,
			});

			const day = startOfDay(DateTime.subtractDuration(currentTime(), Duration.days(30)));
			yield* createQueryEngineEvent(client, {
				entityId: entity.id,
				occurredAt: toIso(day),
				eventSchemaId: reviewSchema.id,
			});

			const result = yield* executeTimeSeriesQueryEngine(
				client,
				buildEventTimeSeriesDoc({
					bucket: "week",
					entityAlias: "item",
					eventAlias: "review",
					entitySchemas: [slug],
					eventSchemas: [reviewSlug],
					startAt: toIso(day),
					endAt: toIso(add(day, Duration.days(1))),
				}),
			);

			expect(result.data.buckets).toHaveLength(1);
			expect(result.data.buckets[0]?.value).toBe(1);
			const bucketStart = result.data.buckets[0]?.startAt;
			expect(bucketStart).toBeDefined();
			expect(DateTime.getPartUtc(DateTime.unsafeMake(bucketStart ?? ""), "weekDay")).toBe(1);
		}),
	);

	it.live("rejects time ranges where startAt is not before endAt", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schemaId, slug } = yield* createQueryEngineTrackerAndSchema(client, {
				schemaName: "TimeSeriesRangeItem",
			});
			const reviewSlug = `time-series-range-${crypto.randomUUID()}`;
			yield* createEventSchema(client, {
				slug: reviewSlug,
				name: "Time Series Range Review",
				entitySchemaId: schemaId,
			});

			const currentIso = toIso(currentTime());
			const error = yield* executeQueryEngineError(
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
		}),
	);
});
