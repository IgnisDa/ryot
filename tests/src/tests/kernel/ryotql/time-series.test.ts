import type { RyotQLResult, TimeSeriesResult } from "@ryot/contract/modules/ryotql/language";
import {
	and,
	castDate,
	castNumber,
	column,
	document,
	eq,
	gte,
	jsonPath,
	literal,
	table,
	timeSeries,
} from "@ryot/ryotql";
import { Effect } from "effect";

import {
	createAuthenticatedClient,
	createEventSchema,
	createQueryEngineEntity,
	createQueryEngineEvent,
	createQueryEnginePluginSchema,
	createRelationship,
	createRelationshipSchema,
	executeRyotQL,
	executeRyotQLError,
} from "~/fixtures";
import { describe, expect, it } from "~/support/effect-test";

const requireTimeSeries = (result: RyotQLResult | undefined, key: string): TimeSeriesResult => {
	if (result?.type !== "timeSeries") {
		throw new Error(`Expected '${key}' time series`);
	}
	return result;
};

describe("RyotQL time-series outputs", () => {
	it.live(
		"uses event time fields, filters, numeric measures, half-open ranges, and zero fill",
		() =>
			Effect.gen(function* () {
				const { client } = yield* createAuthenticatedClient();
				const { schemaId } = yield* createQueryEnginePluginSchema(client, {
					schemaName: "RyotQLTimeSeriesEvent",
				});
				const eventSchema = yield* createEventSchema(client, {
					entitySchemaSlug: schemaId,
					name: "RyotQL Time Series Review",
					slug: `ryotql-time-series-review-${crypto.randomUUID()}`,
					propertiesSchema: {
						fields: { rating: { type: "integer", label: "Rating", description: "Rating" } },
					},
				});
				const entity = yield* createQueryEngineEntity(client, {
					entitySchemaSlug: schemaId,
					name: "RyotQL Time Series Entity",
				});
				for (const [occurredAt, rating] of [
					["2025-01-01T12:00:00.000Z", 5],
					["2025-01-01T13:00:00.000Z", 3],
					["2025-01-03T12:00:00.000Z", 7],
					["2025-01-04T00:00:00.000Z", 100],
				] as const) {
					yield* createQueryEngineEvent(client, {
						occurredAt,
						entityId: entity.id,
						properties: { rating },
						eventSchemaSlug: eventSchema.slug,
					});
				}

				const event = table("event", "event");
				const rating = castNumber(jsonPath(column(event, "properties"), "rating"));
				const where = eq(column(event, "eventSchemaSlug"), literal(eventSchema.slug));
				const range = {
					bucket: "day" as const,
					endAt: "2025-01-04T00:00:00.000Z",
					startAt: "2025-01-01T00:00:00.000Z",
				};
				const result = yield* executeRyotQL(
					client,
					document({
						occurred: timeSeries(event, {
							...range,
							where,
							measure: { function: "count" },
							time: column(event, "occurredAt"),
						}),
						created: timeSeries(event, {
							...range,
							where,
							measure: { function: "count" },
							time: column(event, "createdAt"),
						}),
						filtered: timeSeries(event, {
							...range,
							measure: { function: "count" },
							time: column(event, "occurredAt"),
							where: and(where, gte(rating, literal(5))),
						}),
						sum: timeSeries(event, {
							...range,
							where,
							measure: { function: "sum", expr: rating },
							time: column(event, "occurredAt"),
						}),
						average: timeSeries(event, {
							...range,
							where,
							measure: { function: "average", expr: rating },
							time: column(event, "occurredAt"),
						}),
						minimum: timeSeries(event, {
							...range,
							where,
							measure: { function: "minimum", expr: rating },
							time: column(event, "occurredAt"),
						}),
						maximum: timeSeries(event, {
							...range,
							where,
							measure: { function: "maximum", expr: rating },
							time: column(event, "occurredAt"),
						}),
					}),
				);

				expect(requireTimeSeries(result.data["occurred"], "occurred").buckets).toEqual([
					{ value: 2, endAt: "2025-01-02T00:00:00.000Z", startAt: "2025-01-01T00:00:00.000Z" },
					{ value: 0, endAt: "2025-01-03T00:00:00.000Z", startAt: "2025-01-02T00:00:00.000Z" },
					{ value: 1, endAt: "2025-01-04T00:00:00.000Z", startAt: "2025-01-03T00:00:00.000Z" },
				]);
				expect(
					requireTimeSeries(result.data["created"], "created").buckets.map(({ value }) => value),
				).toEqual([0, 0, 0]);
				expect(
					requireTimeSeries(result.data["filtered"], "filtered").buckets.map(({ value }) => value),
				).toEqual([1, 0, 1]);
				expect(
					requireTimeSeries(result.data["sum"], "sum").buckets.map(({ value }) => value),
				).toEqual([8, 0, 7]);
				expect(
					requireTimeSeries(result.data["average"], "average").buckets.map(({ value }) => value),
				).toEqual([4, 0, 7]);
				expect(
					requireTimeSeries(result.data["minimum"], "minimum").buckets.map(({ value }) => value),
				).toEqual([3, 0, 7]);
				expect(
					requireTimeSeries(result.data["maximum"], "maximum").buckets.map(({ value }) => value),
				).toEqual([5, 0, 7]);
			}),
	);

	it.live("aligns JSON hour and week buckets and relationship calendar months in UTC", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schemaId, slug } = yield* createQueryEnginePluginSchema(client, {
				schemaName: "RyotQLTimeSeriesDate",
				propertiesSchema: {
					fields: {
						publishedAt: { type: "string", label: "Published At", description: "Published At" },
					},
				},
			});
			const entities = yield* Effect.all([
				createQueryEngineEntity(client, {
					name: "Published Entity",
					entitySchemaSlug: schemaId,
					properties: { publishedAt: "2026-01-07T12:30:00.000Z" },
				}),
				createQueryEngineEntity(client, {
					entitySchemaSlug: schemaId,
					name: "Malformed Date Entity",
					properties: { publishedAt: "not-a-date" },
				}),
			]);
			const relationshipSlug = `ryotql-time-series-link-${crypto.randomUUID()}`;
			const relationshipSchema = yield* createRelationshipSchema(client, {
				slug: relationshipSlug,
				name: "RyotQL Time Series Link",
				sourceEntitySchemaSlug: schemaId,
				targetEntitySchemaSlug: schemaId,
			});
			const source = entities[0];
			const target = entities[1];
			if (!source || !target) {
				throw new Error("Expected time-series entities");
			}
			yield* createRelationship(client, {
				sourceEntityId: source.id,
				targetEntityId: target.id,
				relationshipSchemaSlug: relationshipSchema.id,
			});

			const entity = table("entity", "entity");
			const relationship = table("relationship", "relationship");
			const publishedAt = castDate(jsonPath(column(entity, "properties"), "publishedAt"));
			const result = yield* executeRyotQL(
				client,
				document({
					hours: timeSeries(entity, {
						bucket: "hour",
						time: publishedAt,
						measure: { function: "count" },
						endAt: "2026-01-07T14:15:00.000Z",
						startAt: "2026-01-07T12:15:00.000Z",
						where: eq(column(entity, "entitySchemaSlug"), literal(slug)),
					}),
					week: timeSeries(entity, {
						bucket: "week",
						time: publishedAt,
						measure: { function: "count" },
						endAt: "2026-01-08T00:00:00.000Z",
						startAt: "2026-01-07T00:00:00.000Z",
						where: eq(column(entity, "entitySchemaSlug"), literal(slug)),
					}),
					months: timeSeries(relationship, {
						bucket: "month",
						measure: { function: "count" },
						endAt: "2031-01-01T00:00:00.000Z",
						startAt: "2020-01-01T00:00:00.000Z",
						time: column(relationship, "createdAt"),
						where: eq(column(relationship, "relationshipSchemaSlug"), literal(relationshipSlug)),
					}),
				}),
			);

			expect(requireTimeSeries(result.data["hours"], "hours").buckets).toEqual([
				{ value: 1, endAt: "2026-01-07T13:00:00.000Z", startAt: "2026-01-07T12:00:00.000Z" },
				{ value: 0, endAt: "2026-01-07T14:00:00.000Z", startAt: "2026-01-07T13:00:00.000Z" },
				{ value: 0, endAt: "2026-01-07T15:00:00.000Z", startAt: "2026-01-07T14:00:00.000Z" },
			]);
			expect(requireTimeSeries(result.data["week"], "week").buckets).toEqual([
				{ value: 1, endAt: "2026-01-12T00:00:00.000Z", startAt: "2026-01-05T00:00:00.000Z" },
			]);
			const months = requireTimeSeries(result.data["months"], "months").buckets;
			expect(months.reduce((total, bucket) => total + bucket.value, 0)).toBe(1);
			expect(months.slice(0, 2)).toEqual([
				{ value: 0, endAt: "2020-02-01T00:00:00.000Z", startAt: "2020-01-01T00:00:00.000Z" },
				{ value: 0, endAt: "2020-03-01T00:00:00.000Z", startAt: "2020-02-01T00:00:00.000Z" },
			]);
		}),
	);

	it.live(
		"canonicalizes accepted boundaries and rejects ranges above the aligned bucket limit",
		() =>
			Effect.gen(function* () {
				const { client } = yield* createAuthenticatedClient();
				const entity = table("entity", "entity");
				const accepted = yield* executeRyotQL(
					client,
					document({
						entities: timeSeries(entity, {
							bucket: "day",
							measure: { function: "count" },
							endAt: "2022-09-27T00:00:00.000500Z",
							startAt: "2020-01-01T01:00:00.000+01:00",
							time: column(entity, "createdAt"),
						}),
					}),
				);
				const buckets = requireTimeSeries(accepted.data["entities"], "entities").buckets;
				expect(buckets).toHaveLength(1000);
				expect(buckets[0]?.startAt).toBe("2020-01-01T00:00:00.000Z");
				expect(buckets.at(-1)?.endAt).toBe("2022-09-27T00:00:00.000Z");

				const error = yield* executeRyotQLError(
					client,
					document({
						entities: timeSeries(entity, {
							bucket: "day",
							measure: { function: "count" },
							endAt: "2028-10-01T00:00:00.000Z",
							startAt: "2026-01-01T00:00:00.000Z",
							time: column(entity, "createdAt"),
						}),
					}),
				);

				expect(error).toMatchObject({ _tag: "BadRequest" });
			}),
	);
});
