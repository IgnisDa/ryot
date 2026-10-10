import { Result, Schema } from "@ryot-app/plugin-kit/effect";
import {
	and,
	ascending,
	castDate,
	column,
	count,
	defineRecipe,
	eq,
	gte,
	latestEventField,
	literal,
	minimum,
	selectedField,
	selectedRows,
	selectedTimeSeries,
	table,
	type Recipe,
} from "@ryot-app/plugin-kit/ryotql";

import { property, propertyNumber } from "./entity-selections";

export const MEASUREMENT_METRIC_LIMIT = 100;
export const MEASUREMENT_SERIES_BATCH_SIZE = 5;

const nullableString = Schema.NullOr(Schema.String);

export const measurementSummaryRecipe = defineRecipe((input: { readonly rangeStart: string }) => {
	const metric = table("entity", "metric");
	const reading = table("event", "summaryReading");
	const metricReadings = and(
		eq(column(reading, "entityId"), column(metric, "id")),
		eq(column(reading, "eventSchemaSlug"), literal("measurement-reading")),
	);
	return {
		map: ({ metrics }) => Result.succeed(metrics.items),
		queries: {
			metrics: selectedRows(metric, {
				limit: MEASUREMENT_METRIC_LIMIT,
				where: eq(column(metric, "entitySchemaSlug"), literal("measurement-metric")),
				orderBy: [ascending(column(metric, "name")), ascending(column(metric, "id"))],
				selection: {
					id: selectedField(column(metric, "id"), Schema.String),
					name: selectedField(column(metric, "name"), Schema.String),
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
				},
			}),
		},
	};
});

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

export type MeasurementSummary = Recipe.Success<typeof measurementSummaryRecipe>[number];
export type MeasurementSeries = Recipe.Success<typeof measurementSeriesRecipe>[number];
