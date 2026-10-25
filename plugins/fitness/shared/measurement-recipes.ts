import { Result, Schema } from "@ryot-app/plugin-kit/effect";
import {
	and,
	ascending,
	castDate,
	column,
	count,
	dateBucket,
	defineRecipe,
	entitySchemaPredicate,
	eq,
	eventSchemaPredicate,
	first,
	groupAscending,
	gte,
	inArray,
	isNotNull,
	join,
	JsonValue,
	latestEventField,
	literal,
	lt,
	minimum,
	type Recipe,
	relationshipSchemaPredicate,
	schemaOwnerPredicate,
	selectedAggregate,
	selectedField,
	selectedMeasure,
	selectedOptionalRow,
	selectedRows,
	table,
	withinPeriod,
} from "@ryot-app/plugin-kit/ryotql";
import {
	type PluginIdentityReference,
	REPORTING_BUCKET_LIMIT,
	type TimeZone,
} from "@ryot-app/plugin-kit/schema";

import { property, propertyNumber } from "./entity-selections";

export const MEASUREMENT_SERIES_BATCH_SIZE = 5;
export const measurementPinRelationshipSchemaSlug = "measurement-metric-pinned";

const nullableString = Schema.NullOr(Schema.String);

export const measurementSummaryRecipe = defineRecipe(
	(input: {
		readonly after?: string | undefined;
		readonly rangeEnd?: string | undefined;
		readonly rangeStart?: string | undefined;
		readonly reference: PluginIdentityReference;
	}) => {
		const metric = table("entity", "metric");
		const reading = table("event", "summaryReading");
		const pin = table("relationship", "summaryPin");
		const metricReadings = and(
			schemaOwnerPredicate(reading, "eventSchemaPluginId", input.reference),
			eq(column(reading, "entityId"), column(metric, "id")),
			eq(column(reading, "eventSchemaSlug"), literal("measurement-reading")),
		);
		return {
			map: ({ metrics }) => Result.succeed(metrics),
			queries: {
				metrics: selectedRows(metric, {
					limit: 100,
					after: input.after,
					where: entitySchemaPredicate(metric, "measurement-metric", input.reference),
					orderBy: [ascending(column(metric, "name")), ascending(column(metric, "id"))],
					selection: {
						id: selectedField(column(metric, "id"), Schema.String),
						name: selectedField(column(metric, "name"), Schema.String),
						key: selectedField(property(metric, "key"), nullableString),
						unit: selectedField(property(metric, "unit"), nullableString),
						firstAt: selectedField(
							minimum(reading, column(reading, "occurredAt"), { where: metricReadings }),
							nullableString,
						),
						latestAt: selectedField(
							latestEventField(reading, {
								where: metricReadings,
								select: column(reading, "occurredAt"),
							}),
							nullableString,
						),
						latestValue: selectedField(
							latestEventField(reading, {
								where: metricReadings,
								select: propertyNumber(reading, "value"),
							}),
							Schema.NullOr(Schema.Finite),
						),
						pinnedAt: selectedField(
							first(pin, {
								select: column(pin, "createdAt"),
								orderBy: [ascending(column(pin, "createdAt"))],
								where: and(
									eq(column(pin, "sourceEntityId"), column(metric, "id")),
									relationshipSchemaPredicate(
										pin,
										measurementPinRelationshipSchemaSlug,
										input.reference,
									),
								),
							}),
							nullableString,
						),
						rangeCount: selectedField(
							count(reading, {
								where: and(
									metricReadings,
									...(input.rangeStart === undefined
										? []
										: [gte(column(reading, "occurredAt"), castDate(literal(input.rangeStart)))]),
									...(input.rangeEnd === undefined
										? []
										: [lt(column(reading, "occurredAt"), castDate(literal(input.rangeEnd)))]),
								),
							}),
							Schema.Finite,
						),
					},
				}),
			},
		};
	},
);

const seriesQueries = (input: SeriesInput) => {
	const reading = table("event", "seriesReading");
	return input.metricIds.map((metricId, index) => {
		const where = and(
			schemaOwnerPredicate(reading, "eventSchemaPluginId", input.reference),
			eq(column(reading, "entityId"), literal(metricId)),
			eq(column(reading, "eventSchemaSlug"), literal("measurement-reading")),
			withinPeriod(column(reading, "occurredAt"), input),
		);
		return [
			`average${index}`,
			selectedAggregate(reading, {
				where,
				limit: REPORTING_BUCKET_LIMIT,
				orderBy: [groupAscending("at")],
				measures: {
					value: selectedMeasure(
						{ function: "average", expr: propertyNumber(reading, "value") },
						Schema.Finite,
					),
				},
				groupBy: {
					at: selectedField(
						dateBucket(column(reading, "occurredAt"), {
							bucket: input.bucket,
							timeZone: input.timeZone,
						}),
						Schema.String,
					),
				},
			}),
		] as const;
	});
};

type SeriesInput = {
	readonly endAt: string;
	readonly startAt: string;
	readonly timeZone: TimeZone;
	readonly metricIds: readonly string[];
	readonly reference: PluginIdentityReference;
	readonly bucket: "day" | "week" | "year" | "month";
};

export const measurementSeriesRecipe = defineRecipe((input: SeriesInput) => ({
	queries: Object.fromEntries(seriesQueries(input)),
	map: (results) =>
		Result.all(
			input.metricIds.map((metricId, index) => {
				const averages = results[`average${index}`];
				if (averages === undefined) {
					return Result.fail(new Error("Measurement series response is incomplete"));
				}
				if (averages.pageInfo?.hasMore) {
					return Result.fail(new Error("Measurement series response is truncated"));
				}
				return Result.succeed({ metricId, points: averages.items });
			}),
		),
}));

export type MeasurementSeries = Recipe.Success<typeof measurementSeriesRecipe>[number];
export type MeasurementSummary = Recipe.Success<typeof measurementSummaryRecipe>["items"][number];

export const measurementEntryRecipe = defineRecipe((entryId: string) => {
	const entry = table("entity", "entry");
	const reading = table("event", "reading");
	return {
		map: ({ entry: found }) => Result.succeed(found ?? null),
		queries: {
			entry: selectedOptionalRow(entry, {
				orderBy: [ascending(column(entry, "id"))],
				where: and(
					eq(column(entry, "id"), literal(entryId)),
					isNotNull(column(entry, "userId")),
					entitySchemaPredicate(entry, "measurement-entry", { kind: "self" }),
				),
				selection: {
					id: selectedField(column(entry, "id"), Schema.String),
					name: selectedField(column(entry, "name"), Schema.String),
					updatedAt: selectedField(column(entry, "updatedAt"), Schema.String),
					properties: selectedField(
						column(entry, "properties"),
						Schema.Record(Schema.String, JsonValue),
					),
					readingCount: selectedField(
						count(reading, {
							where: and(
								eq(column(reading, "sessionEntityId"), column(entry, "id")),
								schemaOwnerPredicate(reading, "eventSchemaPluginId", { kind: "self" }),
								eq(column(reading, "eventSchemaSlug"), literal("measurement-reading")),
							),
						}),
						Schema.Int,
					),
				},
			}),
		},
	};
});

export const measurementEntryReadingsRecipe = defineRecipe(
	(input: {
		readonly entryId: string;
		readonly after?: string | undefined;
		readonly reference: PluginIdentityReference;
	}) => {
		const reading = table("event", "reading");
		const metric = table("entity", "metric");
		return {
			map: ({ readings }) => Result.succeed(readings),
			queries: {
				readings: selectedRows(reading, {
					limit: 100,
					after: input.after,
					orderBy: [ascending(column(reading, "id"))],
					joins: [join("inner", metric, eq(column(reading, "entityId"), column(metric, "id")))],
					selection: {
						id: selectedField(column(reading, "id"), Schema.String),
						metricId: selectedField(column(metric, "id"), Schema.String),
						value: selectedField(propertyNumber(reading, "value"), Schema.Finite),
					},
					where: and(
						eq(column(reading, "sessionEntityId"), literal(input.entryId)),
						eventSchemaPredicate(
							reading,
							metric,
							"measurement-metric",
							"measurement-reading",
							input.reference,
						),
					),
				}),
			},
		};
	},
);

export const measurementMetricIdsRecipe = defineRecipe((metricIds: readonly string[]) => {
	const metric = table("entity", "metric");
	return {
		map: ({ metrics }) => Result.succeed(metrics.items.map(({ id }) => id)),
		queries: {
			metrics: selectedRows(metric, {
				limit: metricIds.length,
				orderBy: [ascending(column(metric, "id"))],
				selection: { id: selectedField(column(metric, "id"), Schema.String) },
				where: and(
					inArray(column(metric, "id"), metricIds.map(literal)),
					entitySchemaPredicate(metric, "measurement-metric", { kind: "self" }),
				),
			}),
		},
	};
});

export const measurementPageReadingsRecipe = defineRecipe(
	(input: {
		readonly after?: string | undefined;
		readonly entryIds: readonly string[];
		readonly reference: PluginIdentityReference;
	}) => {
		const reading = table("event", "reading");
		const metric = table("entity", "metric");
		return {
			map: ({ readings }) => Result.succeed(readings),
			queries: {
				readings: selectedRows(reading, {
					limit: 100,
					after: input.after,
					orderBy: [ascending(column(reading, "id"))],
					joins: [join("inner", metric, eq(column(reading, "entityId"), column(metric, "id")))],
					where: and(
						inArray(column(reading, "sessionEntityId"), input.entryIds.map(literal)),
						eventSchemaPredicate(
							reading,
							metric,
							"measurement-metric",
							"measurement-reading",
							input.reference,
						),
					),
					selection: {
						id: selectedField(column(reading, "id"), Schema.String),
						metricId: selectedField(column(metric, "id"), Schema.String),
						value: selectedField(propertyNumber(reading, "value"), Schema.Finite),
						entryId: selectedField(column(reading, "sessionEntityId"), Schema.String),
					},
				}),
			},
		};
	},
);

export type MeasurementEntryReading = Recipe.Success<
	typeof measurementPageReadingsRecipe
>["items"][number];

export const pinnedMeasurementMetricIdsRecipe = defineRecipe(() => {
	const pin = table("relationship", "pin");
	return {
		map: ({ pins }) => Result.succeed(pins.items.map(({ metricId }) => metricId)),
		queries: {
			pins: selectedRows(pin, {
				limit: 100,
				orderBy: [ascending(column(pin, "id"))],
				selection: { metricId: selectedField(column(pin, "sourceEntityId"), Schema.String) },
				where: relationshipSchemaPredicate(pin, measurementPinRelationshipSchemaSlug, {
					kind: "self",
				}),
			}),
		},
	};
});

export const allMeasurementMetricIdsRecipe = defineRecipe((limit: number) => {
	const metric = table("entity", "metric");
	return {
		map: ({ metrics }) => Result.succeed(metrics.items.map(({ id }) => id)),
		queries: {
			metrics: selectedRows(metric, {
				limit,
				orderBy: [ascending(column(metric, "id"))],
				selection: { id: selectedField(column(metric, "id"), Schema.String) },
				where: entitySchemaPredicate(metric, "measurement-metric", { kind: "self" }),
			}),
		},
	};
});
