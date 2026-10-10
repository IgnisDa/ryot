import { Result, Schema } from "@ryot-app/plugin-kit/effect";
import {
	and,
	ascending,
	castDate,
	column,
	count,
	defineRecipe,
	entitySchemaPredicate,
	eq,
	eventSchemaPredicate,
	first,
	gte,
	inArray,
	join,
	latestEventField,
	literal,
	minimum,
	type Recipe,
	relationshipSchemaPredicate,
	schemaOwnerPredicate,
	selectedField,
	selectedRows,
	selectedTimeSeries,
	table,
} from "@ryot-app/plugin-kit/ryotql";
import type { PluginIdentityReference } from "@ryot-app/plugin-kit/schema";

import { property, propertyNumber } from "./entity-selections";

export const MEASUREMENT_SERIES_BATCH_SIZE = 5;

export const measurementPinRelationshipSchemaSlug = "measurement-metric-pinned";

const nullableString = Schema.NullOr(Schema.String);

export const measurementSummaryRecipe = defineRecipe(
	(input: {
		readonly reference: PluginIdentityReference;
		readonly rangeStart: string;
		readonly after?: string | undefined;
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
						rangeCount: selectedField(
							count(reading, {
								where: and(
									metricReadings,
									gte(column(reading, "occurredAt"), castDate(literal(input.rangeStart))),
								),
							}),
							Schema.Finite,
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
					},
				}),
			},
		};
	},
);

const seriesQueries = (input: SeriesInput) => {
	const reading = table("event", "seriesReading");
	const base = {
		endAt: input.endAt,
		bucket: input.bucket,
		startAt: input.startAt,
		time: column(reading, "occurredAt"),
	};
	const selection = { value: Schema.Finite, endAt: Schema.String, startAt: Schema.String };
	return input.metricIds.flatMap((metricId, index) => {
		const where = and(
			schemaOwnerPredicate(reading, "eventSchemaPluginId", input.reference),
			eq(column(reading, "entityId"), literal(metricId)),
			eq(column(reading, "eventSchemaSlug"), literal("measurement-reading")),
		);
		return [
			[
				`average${index}`,
				selectedTimeSeries(reading, {
					...base,
					where,
					selection,
					measure: { function: "average", expr: propertyNumber(reading, "value") },
				}),
			],
			[
				`count${index}`,
				selectedTimeSeries(reading, { ...base, where, selection, measure: { function: "count" } }),
			],
		] as const;
	});
};

type SeriesInput = {
	readonly reference: PluginIdentityReference;
	readonly endAt: string;
	readonly startAt: string;
	readonly bucket: "day" | "week";
	readonly metricIds: readonly string[];
};

export const measurementSeriesRecipe = defineRecipe((input: SeriesInput) => ({
	queries: Object.fromEntries(seriesQueries(input)),
	map: (results) =>
		Result.all(
			input.metricIds.map((metricId, index) => {
				const averages = results[`average${index}`];
				const counts = results[`count${index}`];
				if (averages === undefined || counts === undefined) {
					return Result.fail(new Error("Measurement series response is incomplete"));
				}
				return Result.succeed({
					metricId,
					points: averages.buckets.flatMap(({ value, startAt }, bucketIndex) =>
						(counts.buckets[bucketIndex]?.value ?? 0) > 0 ? [{ value, at: startAt }] : [],
					),
				});
			}),
		),
}));

export type MeasurementSummary = Recipe.Success<typeof measurementSummaryRecipe>["items"][number];
export type MeasurementSeries = Recipe.Success<typeof measurementSeriesRecipe>[number];

export const measurementReadingsRecipe = defineRecipe((readingIds: readonly string[]) => {
	const reading = table("event", "reading");
	const metric = table("entity", "metric");
	return {
		map: ({ readings }) => Result.succeed(readings.items),
		queries: {
			readings: selectedRows(reading, {
				limit: readingIds.length,
				orderBy: [ascending(column(reading, "id"))],
				joins: [join("inner", metric, eq(column(reading, "entityId"), column(metric, "id")))],
				selection: {
					id: selectedField(column(reading, "id"), Schema.String),
					metricId: selectedField(column(metric, "id"), Schema.String),
				},
				where: and(
					inArray(column(reading, "id"), readingIds.map(literal)),
					eventSchemaPredicate(reading, metric, "measurement-metric", "measurement-reading", {
						kind: "self",
					}),
				),
			}),
		},
	};
});

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
