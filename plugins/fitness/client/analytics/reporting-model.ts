import {
	type AnalyticsSectionProps,
	calendarBuckets,
	type PluginIdentityReference,
	type ReportingCalendar,
	type ReportingExecution,
	type ReportingPeriod,
	type ReportingSelection,
	type ResolvedReportingSelection,
	type TimeZone,
} from "@ryot-app/plugin-client-sdk/plugin";
import type { Text } from "@ryot-app/plugin-client-sdk/react";
import type { Recipe } from "@ryot-app/plugin-client-sdk/ryotql";
import { measureUnit, type MetricUnit } from "@ryot-app/plugin-ui-sdk";

import type {
	FitnessAnalyticsFilter,
	FitnessAnalyticsMetric,
	fitnessAnalyticsTotalsRecipe,
	fitnessAnalyticsTrendRecipe,
	fitnessAnalyticsWorkoutsRecipe,
	fitnessMeasurementReadingsRecipe,
	fitnessMeasurementTrendRecipe,
	fitnessWorkoutStartsByHourRecipe,
	historicalFitnessRankingRecipe,
} from "../../shared/analytics-recipes";
import { fitnessMetricDefinitions, type FitnessMetricUnit } from "../../shared/fitness-metrics";
import { smoothRuns } from "../../shared/measurement-metrics";
import type { measurementSummaryRecipe } from "../../shared/measurement-recipes";
import type { WorkoutPreferenceSettings } from "../../shared/workout-editor-preferences";
import { type ConvertedMeasure, displayMeasure } from "../../shared/workout-units";
import type { countUnits, FitnessText } from "../messages";
import { displayUnit } from "../workout/format";

export type AnalyticsScope = AnalyticsSectionProps;
export type AnalyticsMetric = FitnessAnalyticsMetric;
export type AnalyticsTrendPoint = AnalyticsTrend["points"][number];
export type AnalyticsFilter = NonNullable<AnalyticsInput["filter"]>;
export type AnalyticsRankingRow = AnalyticsRanking["items"][number];
export type MeasurementMetric = MeasurementMetrics["items"][number];
export type AnalyticsWorkoutRow = AnalyticsWorkouts["items"][number];
export type MeasurementReading = MeasurementReadings["items"][number];
export type MeasurementTrendPoint = MeasurementTrend["points"][number];
export type MeasurementMetrics = Recipe.Success<ReturnType<typeof measurementSummaryRecipe>>;
export type AnalyticsTotals = Recipe.Success<ReturnType<typeof fitnessAnalyticsTotalsRecipe>>;
export type WorkoutHours = Recipe.Success<ReturnType<typeof fitnessWorkoutStartsByHourRecipe>>;
export type AnalyticsRanking = Recipe.Success<ReturnType<typeof historicalFitnessRankingRecipe>>;
export type AnalyticsWorkouts = Recipe.Success<ReturnType<typeof fitnessAnalyticsWorkoutsRecipe>>;
export type MeasurementReadings = Recipe.Success<
	ReturnType<typeof fitnessMeasurementReadingsRecipe>
>;
export type AnalyticsDisplayPreferences = Pick<
	WorkoutPreferenceSettings,
	"unitSystem" | "energyUnit"
>;
export type MetricUnitContext = {
	readonly text: FitnessText;
	readonly units: ReturnType<typeof countUnits>;
};

export type WorkoutDrillRequest = {
	readonly title: string;
	readonly periodCaption: string;
	readonly filter?: AnalyticsFilter;
	readonly selection: ReportingSelection;
};
export type AnalyticsInput = {
	readonly timeZone: TimeZone;
	readonly selection: ReportingSelection;
	readonly filter?: FitnessAnalyticsFilter;
	readonly reference: PluginIdentityReference;
};
export type MeasurementTrend = Recipe.Success<ReturnType<typeof fitnessMeasurementTrendRecipe>> & {
	readonly metricId: string;
	readonly period: null | ReportingPeriod;
	readonly grouping: ResolvedReportingSelection["grouping"];
};

export type AnalyticsTrend = Recipe.Success<ReturnType<typeof fitnessAnalyticsTrendRecipe>> & {
	readonly metric: FitnessAnalyticsMetric;
	readonly period: null | ReportingPeriod;
	readonly grouping: ResolvedReportingSelection["grouping"];
};

export const metricDisplay = (
	context: MetricUnitContext,
	metric: keyof typeof fitnessMetricDefinitions,
	value: null | number,
	preferences: AnalyticsDisplayPreferences,
): { readonly unit: MetricUnit; readonly value: null | number } => {
	const definition: { readonly unit: FitnessMetricUnit } | { readonly measure: ConvertedMeasure } =
		fitnessMetricDefinitions[metric];
	if (!("measure" in definition)) {
		return {
			value,
			unit:
				definition.unit.kind === "count" ? context.units(definition.unit.noun) : definition.unit,
		};
	}
	const display = displayMeasure(definition.measure, value ?? 0, preferences);
	return {
		value: value === null ? null : display.value,
		unit: measureUnit(displayUnit(context.text, display)),
	};
};

export type TrendBucket<Point> = {
	readonly at: string;
	readonly value: null | number;
	readonly source: null | Point;
	readonly period: ReportingPeriod;
	readonly detail: Text | undefined;
};

export const trendBuckets = <Point extends { readonly at: string; readonly value: null | number }>(
	text: FitnessText,
	trend: {
		readonly points: readonly Point[];
		readonly period: null | ReportingPeriod;
		readonly grouping: ReportingExecution["resolved"]["grouping"];
	},
	calendar: ReportingCalendar,
	emptyValue: 0 | null = null,
): ReadonlyArray<TrendBucket<Point>> =>
	calendarBuckets(trend.points, {
		...calendar,
		period: trend.period,
		at: (point) => point.at,
		grouping: trend.grouping,
	}).map((bucket) => {
		const source = bucket.points[0] ?? null;
		return {
			source,
			period: bucket.period,
			at: bucket.period.startAt,
			value: source === null ? emptyValue : source.value,
			detail:
				source === null && emptyValue === null
					? text("client.analytics.trend.detail-no-value")
					: undefined,
		};
	});

const trendBucketDetail = (text: FitnessText, point: AnalyticsTrendPoint) => {
	const known = point.knownValues ?? 0;
	const partial = known < point.observations;
	if (point.processing === "ready") {
		return partial
			? text("client.analytics.trend.detail-partial", { known, observations: point.observations })
			: undefined;
	}
	return partial
		? text("client.analytics.trend.detail-partial-processing", {
				known,
				processing: point.processing,
				observations: point.observations,
			})
		: text("client.analytics.trend.detail-processing", { processing: point.processing });
};

export const workoutTrendModel = (
	context: MetricUnitContext,
	current: AnalyticsTrend,
	previous: null | AnalyticsTrend,
	calendar: ReportingCalendar,
	preferences: AnalyticsDisplayPreferences,
) => {
	const build = (trend: AnalyticsTrend) =>
		trendBuckets(
			context.text,
			trend,
			calendar,
			trend.metric === "workouts" || trend.metric === "sets" ? 0 : null,
		).map((bucket) =>
			Object.assign({}, bucket, {
				value: metricDisplay(context, trend.metric, bucket.value, preferences).value,
				detail:
					bucket.source === null ? bucket.detail : trendBucketDetail(context.text, bucket.source),
			}),
		);
	const comparable =
		previous !== null &&
		previous.metric === current.metric &&
		previous.grouping === current.grouping;
	return {
		current: build(current),
		previous: comparable ? build(previous) : null,
		unit: metricDisplay(context, current.metric, null, preferences).unit,
	};
};

const averageDetail = (text: FitnessText, count: number, smoothing: null | number) =>
	smoothing === null
		? text("client.analytics.trend.detail-average", { count })
		: text("client.analytics.trend.detail-average-smoothed", { count, points: smoothing });

export const measurementTrendModel = (
	text: FitnessText,
	current: MeasurementTrend,
	previous: null | MeasurementTrend,
	calendar: ReportingCalendar,
	smooth = false,
) => {
	const build = (trend: MeasurementTrend) => {
		const buckets = trendBuckets(text, trend, calendar);
		return (
			smooth
				? smoothRuns(buckets, (left, right) => left.source?.unit !== right.source?.unit)
				: buckets.map((bucket) => Object.assign({}, bucket, { smoothing: null }))
		).map((bucket) =>
			Object.assign({}, bucket, {
				detail:
					bucket.source === null
						? text("client.analytics.trend.detail-no-readings")
						: averageDetail(text, bucket.source.readings, bucket.smoothing),
			}),
		);
	};
	const units = new Set(
		[...current.points, ...(previous?.points ?? [])].map((point) => point.unit),
	);
	const comparable =
		units.size <= 1 &&
		previous?.metricId === current.metricId &&
		previous.grouping === current.grouping;
	return {
		current: build(current),
		mixedUnits: units.size > 1,
		previous: comparable ? build(previous) : null,
		unit: units.size === 1 ? ([...units][0] ?? null) : null,
	};
};

export const consistencyModel = (
	text: FitnessText,
	trend: AnalyticsTrend & { readonly clipped?: boolean },
	calendar: ReportingCalendar,
) => ({
	period: trend.period,
	clipped: trend.clipped ?? false,
	days: trendBuckets(text, trend, calendar, 0).map(({ value, period }) => ({
		value,
		date: period.startDate,
	})),
});
