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
import { rollingAverage, trendWindow } from "../../shared/measurement-metrics";
import type { measurementSummaryRecipe } from "../../shared/measurement-recipes";
import type { WorkoutPreferenceSettings } from "../../shared/workout-editor-preferences";
import {
	kilocaloriesToEnergy,
	kilogramsToPounds,
	kilometersToMiles,
} from "../../shared/workout-units";

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

export type AnalyticsDisplayPreferences = Pick<
	WorkoutPreferenceSettings,
	"unitSystem" | "energyUnit"
>;
export type AnalyticsSummary = Reported<{
	readonly current: AnalyticsTotals;
	readonly previous: null | AnalyticsTotals;
}>;
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
) => {
	let unit: string = fitnessMetricDefinitions[metric].unit;
	let quantity = value;
	if (metric === "volume") {
		unit = preferences.unitSystem === "imperial" ? "lb × reps" : "kg × reps";
		if (preferences.unitSystem === "imperial") {
			quantity = value === null ? null : kilogramsToPounds(value);
		}
	} else if (metric === "distance" && preferences.unitSystem === "imperial") {
		unit = "mi";
		quantity = value === null ? null : kilometersToMiles(value);
	} else if (metric === "calories") {
		unit = preferences.energyUnit;
		quantity = value === null ? null : kilocaloriesToEnergy(value, preferences.energyUnit);
	}
	return { unit, value: quantity };
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
				detail:
					bucket.source === null
						? bucket.detail
						: `${bucket.source.observations} observations; ${bucket.source.knownValues ?? 0} known values; ${bucket.source.pendingSets ?? 0} pending sets; ${bucket.source.failedSets ?? 0} failed sets`,
			}),
		);
	const comparable =
		previous !== null &&
		previous.metric === current.metric &&
		previous.unit === current.unit &&
		previous.grouping === current.grouping;
	return {
		current: build(current),
		previous: comparable ? build(previous) : null,
		unit: metricDisplay(current.metric, null, preferences).unit,
	};
};

export const smoothMeasurementBuckets = (
	buckets: ReadonlyArray<TrendBucket<MeasurementTrend["points"][number]>>,
) => {
	const result: Array<
		{ readonly smoothing: 3 | 7 | null } & TrendBucket<MeasurementTrend["points"][number]>
	> = buckets.map((bucket) => Object.assign({}, bucket, { smoothing: null }));
	let start = 0;
	while (start < result.length) {
		const first = result[start];
		if (first?.value == null) {
			start++;
			continue;
		}
		let end = start + 1;
		while (
			end < result.length &&
			result[end]?.value !== null &&
			result[end]?.source?.unit === first.source?.unit
		) {
			end++;
		}
		const run = result
			.slice(start, end)
			.flatMap(({ at, value }) => (value === null ? [] : [{ at, value }]));
		const smoothed = rollingAverage(run);
		const smoothing = trendWindow(run.length);
		for (let index = start; index < end; index++) {
			const bucket = result[index];
			const point = smoothed[index - start];
			if (bucket !== undefined && point !== undefined) {
				result[index] = { ...bucket, smoothing, value: point.value };
			}
		}
		start = end;
	}
	return result;
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
				? smoothMeasurementBuckets(buckets)
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
