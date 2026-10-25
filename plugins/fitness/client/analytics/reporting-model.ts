import {
	addCalendarDays,
	type AnalyticsSectionProps,
	calendarBuckets,
	localDateOf,
	periodCaption,
	type Reported,
	type ReportingExecution,
	type ReportingPeriod,
	type ReportingSelection,
	resolveReportingSelection,
	type TimeZone,
} from "@ryot-app/plugin-client-sdk/plugin";
import type { Recipe } from "@ryot-app/plugin-client-sdk/ryotql";

import type {
	fitnessAnalyticsTotalsRecipe,
	fitnessAnalyticsTrendRecipe,
	fitnessAnalyticsWorkoutsRecipe,
	fitnessMeasurementReadingsRecipe,
	fitnessMeasurementTrendRecipe,
	fitnessWorkoutStartsByHourRecipe,
	historicalFitnessRankingRecipe,
} from "../../shared/analytics-recipes";
import { fitnessMetricDefinitions } from "../../shared/fitness-metrics";
import { smoothRuns } from "../../shared/measurement-metrics";
import type { measurementSummaryRecipe } from "../../shared/measurement-recipes";
import type { WorkoutPreferenceSettings } from "../../shared/workout-editor-preferences";
import { type ConvertedMeasure, displayMeasure } from "../../shared/workout-units";

export type AnalyticsScope = AnalyticsSectionProps;
export type AnalyticsTrendPoint = AnalyticsTrend["points"][number];
export type AnalyticsFilter = NonNullable<AnalyticsInput["filter"]>;
export type AnalyticsRankingRow = AnalyticsRanking["items"][number];
export type MeasurementMetric = MeasurementMetrics["items"][number];
export type AnalyticsWorkoutRow = AnalyticsWorkouts["items"][number];
export type MeasurementReading = MeasurementReadings["items"][number];
export type MeasurementTrendPoint = MeasurementTrend["points"][number];
export type AnalyticsTrend = Recipe.Success<typeof fitnessAnalyticsTrendRecipe>;
export type MeasurementMetrics = Recipe.Success<typeof measurementSummaryRecipe>;
export type AnalyticsTotals = Recipe.Success<typeof fitnessAnalyticsTotalsRecipe>;
export type WorkoutHours = Recipe.Success<typeof fitnessWorkoutStartsByHourRecipe>;
export type MeasurementTrend = Recipe.Success<typeof fitnessMeasurementTrendRecipe>;
export type AnalyticsRanking = Recipe.Success<typeof historicalFitnessRankingRecipe>;
export type AnalyticsWorkouts = Recipe.Success<typeof fitnessAnalyticsWorkoutsRecipe>;
export type AnalyticsMetric = Parameters<typeof fitnessAnalyticsTrendRecipe>[0]["metric"];
export type MeasurementReadings = Recipe.Success<typeof fitnessMeasurementReadingsRecipe>;
export type AnalyticsInput = Omit<Parameters<typeof fitnessAnalyticsTotalsRecipe>[0], "now">;

export type Compared<Data> = Reported<{ readonly current: Data; readonly previous: null | Data }>;
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

export const metricDisplay = (
	metric: keyof typeof fitnessMetricDefinitions,
	value: null | number,
	preferences: AnalyticsDisplayPreferences,
): { readonly unit: string; readonly value: null | number } => {
	const definition: { readonly unit: string } | { readonly measure: ConvertedMeasure } =
		fitnessMetricDefinitions[metric];
	if (!("measure" in definition)) {
		return { value, unit: definition.unit };
	}
	return value === null
		? { value, unit: displayMeasure(definition.measure, 0, preferences).unit }
		: displayMeasure(definition.measure, value, preferences);
};

export type TrendBucket<Point> = {
	readonly at: string;
	readonly detail: string;
	readonly value: null | number;
	readonly source: null | Point;
	readonly period: ReportingPeriod;
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
		const missingDetail = emptyValue === 0 ? "No activity" : "No known value";
		return {
			source,
			period: bucket.period,
			at: bucket.period.startAt,
			value: source === null ? emptyValue : source.value,
			detail: source === null ? missingDetail : "Recorded bucket",
		};
	});

const trendBucketDetail = (point: AnalyticsTrendPoint) => {
	const known = `${point.knownValues ?? 0} of ${point.observations} with a value`;
	const unavailable = (point.pendingSets ?? 0) + (point.failedSets ?? 0);
	return unavailable === 0 ? known : `${known}; ${unavailable} sets still processing or failed`;
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
						: `${bucket.source.readings} readings; grouped average${bucket.smoothing === null ? "" : `; ${bucket.smoothing}-point smoothing`}`,
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

export const consistencySelection = (input: AnalyticsInput, now: number) => {
	const resolved = resolveReportingSelection(input.selection, { now, timeZone: input.timeZone });
	const endDate = resolved.current?.endDate ?? localDateOf(now, input.timeZone);
	const earliest = addCalendarDays(endDate, -(26 * 7 - 1));
	const startDate =
		resolved.current === null || resolved.current.startDate < earliest
			? earliest
			: resolved.current.startDate;
	return {
		clipped: resolved.current === null || resolved.current.startDate < startDate,
		selection: {
			grouping: "day",
			comparison: "none",
			range: { endDate, startDate, kind: "custom" },
		} satisfies ReportingSelection,
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
