import {
	type AnalyticsSectionProps,
	calendarBuckets,
	periodCaption,
	type PluginIdentityReference,
	type ReportingExecution,
	type ReportingPeriod,
	type ReportingSelection,
	type ResolvedReportingSelection,
	type TimeZone,
} from "@ryot-app/plugin-client-sdk/plugin";
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
	metric: keyof typeof fitnessMetricDefinitions,
	value: null | number,
	preferences: AnalyticsDisplayPreferences,
): { readonly unit: MetricUnit; readonly value: null | number } => {
	const definition: { readonly unit: FitnessMetricUnit } | { readonly measure: ConvertedMeasure } =
		fitnessMetricDefinitions[metric];
	if (!("measure" in definition)) {
		return { value, unit: definition.unit };
	}
	const display = displayMeasure(definition.measure, value ?? 0, preferences);
	return { unit: measureUnit(display.unit), value: value === null ? null : display.value };
};

export type TrendBucket<Point> = {
	readonly at: string;
	readonly value: null | number;
	readonly source: null | Point;
	readonly period: ReportingPeriod;
	readonly detail: string | undefined;
};

export const trendBuckets = <Point extends { readonly at: string; readonly value: null | number }>(
	trend: {
		readonly points: readonly Point[];
		readonly period: null | ReportingPeriod;
		readonly grouping: ReportingExecution["resolved"]["grouping"];
	},
	timeZone: TimeZone,
	emptyValue: 0 | null = null,
): ReadonlyArray<TrendBucket<Point>> =>
	calendarBuckets(trend.points, {
		timeZone,
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
			detail: source === null && emptyValue === null ? "No known value" : undefined,
		};
	});

const processingDetail = {
	ready: [],
	pending: ["Still processing"],
	failed: ["Processing failed"],
} as const;

const trendBucketDetail = (point: AnalyticsTrendPoint) => {
	const known = point.knownValues ?? 0;
	const parts = [
		...(known < point.observations ? [`${known} of ${point.observations} with a value`] : []),
		...processingDetail[point.processing],
	];
	return parts.length === 0 ? undefined : parts.join(" · ");
};

export const workoutTrendModel = (
	current: AnalyticsTrend,
	previous: null | AnalyticsTrend,
	timeZone: TimeZone,
	preferences: AnalyticsDisplayPreferences,
) => {
	const build = (trend: AnalyticsTrend) =>
		trendBuckets(
			trend,
			timeZone,
			trend.metric === "workouts" || trend.metric === "sets" ? 0 : null,
		).map((bucket) =>
			Object.assign({}, bucket, {
				value: metricDisplay(trend.metric, bucket.value, preferences).value,
				detail: bucket.source === null ? bucket.detail : trendBucketDetail(bucket.source),
			}),
		);
	const comparable =
		previous !== null &&
		previous.metric === current.metric &&
		previous.grouping === current.grouping;
	return {
		current: build(current),
		previous: comparable ? build(previous) : null,
		unit: metricDisplay(current.metric, null, preferences).unit,
	};
};

export const measurementTrendModel = (
	current: MeasurementTrend,
	previous: null | MeasurementTrend,
	timeZone: TimeZone,
	smooth = false,
) => {
	const build = (trend: MeasurementTrend) => {
		const buckets = trendBuckets(trend, timeZone);
		return (
			smooth
				? smoothRuns(buckets, (left, right) => left.source?.unit !== right.source?.unit)
				: buckets.map((bucket) => Object.assign({}, bucket, { smoothing: null }))
		).map((bucket) =>
			Object.assign({}, bucket, {
				detail:
					bucket.source === null
						? "No readings"
						: `Average of ${bucket.source.readings} ${bucket.source.readings === 1 ? "reading" : "readings"}${bucket.smoothing === null ? "" : ` · ${bucket.smoothing}-point smoothing`}`,
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
	trend: AnalyticsTrend & { readonly clipped?: boolean },
	timeZone: TimeZone,
) => ({
	clipped: trend.clipped ?? false,
	periodCaption: periodCaption(trend.period),
	days: trendBuckets(trend, timeZone, 0).map(({ value, period }) => ({
		value,
		date: period.startDate,
	})),
});
