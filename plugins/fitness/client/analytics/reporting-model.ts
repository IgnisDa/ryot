import {
	addCalendarDays,
	addCalendarUnits,
	type AnalyticsSectionProps,
	calendarPeriod,
	localDateOf,
	type ReportingSelection,
	resolveReportingSelection,
	startOfCalendarUnit,
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
export type ReportingGrouping = ReportingResolution["grouping"];
export type AnalyticsTrendPoint = AnalyticsTrend["points"][number];
export type AnalyticsFilter = NonNullable<AnalyticsInput["filter"]>;
export type AnalyticsRankingRow = AnalyticsRanking["items"][number];
export type MeasurementMetric = MeasurementMetrics["items"][number];
export type AnalyticsWorkoutRow = AnalyticsWorkouts["items"][number];
export type MeasurementReading = MeasurementReadings["items"][number];
export type MeasurementTrendPoint = MeasurementTrend["points"][number];
export type ReportingPeriod = NonNullable<ReportingResolution["current"]>;
export type ReportingResolution = ReturnType<typeof resolveReportingSelection>;
export type Reported<Data> = Data & { readonly reporting: ReportingExecution };
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
export type ReportingExecution = {
	readonly now: number;
	readonly resolved: ReportingResolution;
	readonly selection: ReportingSelection;
};
export type WorkoutDrillRequest = {
	readonly title: string;
	readonly periodCaption: string;
	readonly filter?: AnalyticsFilter;
	readonly selection: ReportingSelection;
};

export const selectionForPeriod = (
	selection: ReportingSelection,
	period: null | ReportingPeriod,
): ReportingSelection => ({
	comparison: "none",
	grouping: selection.grouping,
	range:
		period === null
			? { kind: "all-time" }
			: { kind: "custom", endDate: period.endDate, startDate: period.startDate },
});

export const reportingExecution = (input: AnalyticsInput, now: number): ReportingExecution => {
	const resolved = resolveReportingSelection(input.selection, { now, timeZone: input.timeZone });
	return {
		now,
		resolved,
		selection: selectionForPeriod(
			{ ...input.selection, grouping: resolved.grouping },
			resolved.current,
		),
	};
};

export const periodCaption = (period: null | ReportingPeriod) => {
	if (period === null) {
		return "All time";
	}
	return period.startDate === period.endDate
		? period.startDate
		: `${period.startDate} – ${period.endDate}`;
};

export const comparisonCaption = (reporting: ReportingExecution) =>
	reporting.resolved.previous === null
		? null
		: `${periodCaption(reporting.resolved.current)} vs ${periodCaption(reporting.resolved.previous)}`;

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

export const formatExactValue = (value: null | number, unit: null | string) => {
	if (value === null || !Number.isFinite(value)) {
		return "Unknown";
	}
	return `${Object.is(value, -0) ? "0" : String(value)}${unit === null || unit === "" ? "" : ` ${unit}`}`;
};

export const compareQuantities = (current: null | number, previous: null | number) => {
	if (
		current === null ||
		previous === null ||
		!Number.isFinite(current) ||
		!Number.isFinite(previous)
	) {
		return { percent: null, absolute: null, kind: "unknown" as const };
	}
	const absolute = current - previous;
	let percent: null | number = null;
	if (previous !== 0) {
		percent = (absolute / Math.abs(previous)) * 100;
	} else if (current === 0) {
		percent = 0;
	}
	return {
		percent,
		absolute,
		kind: previous === 0 && current > 0 ? ("new-activity" as const) : ("change" as const),
	};
};

export type TrendGrid<Point> = {
	readonly partial: boolean;
	readonly complete: boolean;
	readonly buckets: readonly TrendBucket<Point>[];
};
export type TrendBucket<Point> = {
	readonly at: string;
	readonly detail: string;
	readonly value: null | number;
	readonly source: null | Point;
	readonly period: ReportingPeriod;
};
type SparseTrend<Point> = {
	readonly hasMore: boolean;
	readonly points: readonly Point[];
	readonly grouping: ReportingGrouping;
	readonly period: null | ReportingPeriod;
};

export const trendGrid = <Point extends { readonly at: string; readonly value: null | number }>(
	trend: SparseTrend<Point>,
	timeZone: TimeZone,
	emptyValue: 0 | null = null,
): TrendGrid<Point> => {
	const points = new Map(
		trend.points.map((point) => [
			startOfCalendarUnit(localDateOf(point.at, timeZone), trend.grouping),
			point,
		]),
	);
	const dates = [...points.keys()].sort();
	const first = trend.period?.startDate ?? dates[0];
	const lastSourceDate = dates.at(-1);
	const sourceEndDate =
		lastSourceDate === undefined
			? undefined
			: addCalendarDays(addCalendarUnits(lastSourceDate, trend.grouping, 1), -1);
	let last = trend.period?.endDate ?? sourceEndDate;
	if (trend.hasMore) {
		const lastKnown = dates.at(-1);
		if (lastKnown === undefined) {
			last = undefined;
		} else {
			const lastKnownEnd = addCalendarDays(addCalendarUnits(lastKnown, trend.grouping, 1), -1);
			if (last === undefined || lastKnownEnd < last) {
				last = lastKnownEnd;
			}
		}
	}
	if (first === undefined || last === undefined) {
		return { buckets: [], partial: trend.hasMore, complete: !trend.hasMore };
	}
	const buckets: TrendBucket<Point>[] = [];
	let date = startOfCalendarUnit(first, trend.grouping);
	for (; date <= last && buckets.length < 1000; date = addCalendarUnits(date, trend.grouping, 1)) {
		const source = points.get(date) ?? null;
		const next = addCalendarUnits(date, trend.grouping, 1);
		const endDate = addCalendarDays(next, -1);
		const period = calendarPeriod(
			first > date ? first : date,
			last < endDate ? last : endDate,
			timeZone,
		);
		const missingDetail = emptyValue === 0 ? "No activity" : "No known value";
		buckets.push({
			period,
			source,
			at: period.startAt,
			value: source === null ? emptyValue : source.value,
			detail: source === null ? missingDetail : "Recorded bucket",
		});
	}
	const partial = trend.hasMore || date <= last;
	return { buckets, partial, complete: !partial };
};

export const pairTrendBuckets = <Point>(
	current: readonly TrendBucket<Point>[],
	previous: readonly TrendBucket<Point>[],
) => ({
	extraPrevious: previous.slice(current.length),
	buckets: current.map((bucket, index) => ({
		...bucket,
		...(previous[index] === undefined ? {} : { comparison: previous[index] }),
	})),
});

export const workoutTrendModel = (
	current: AnalyticsTrend,
	previous: null | AnalyticsTrend,
	timeZone: TimeZone,
	preferences: AnalyticsDisplayPreferences,
) => {
	const build = (trend: AnalyticsTrend) => {
		const grid = trendGrid(
			trend,
			timeZone,
			trend.metric === "workouts" || trend.metric === "sets" ? 0 : null,
		);
		return {
			...grid,
			buckets: grid.buckets.map((bucket) =>
				Object.assign({}, bucket, {
					value: metricDisplay(trend.metric, bucket.value, preferences).value,
					detail:
						bucket.source === null
							? bucket.detail
							: `${bucket.source.observations} observations; ${bucket.source.knownValues ?? 0} known values; ${bucket.source.pendingSets ?? 0} pending sets; ${bucket.source.failedSets ?? 0} failed sets`,
				}),
			),
		};
	};
	const currentGrid = build(current);
	const previousGrid = previous === null ? null : build(previous);
	const comparable =
		previous !== null &&
		previous.metric === current.metric &&
		previous.unit === current.unit &&
		previous.grouping === current.grouping;
	return {
		...pairTrendBuckets(currentGrid.buckets, comparable ? (previousGrid?.buckets ?? []) : []),
		current: currentGrid,
		previous: previousGrid,
		unit: metricDisplay(current.metric, null, preferences).unit,
		partial: currentGrid.partial || (previousGrid?.partial ?? false),
	};
};

export const smoothMeasurementBuckets = (
	buckets: readonly TrendBucket<MeasurementTrend["points"][number]>[],
) => {
	const result: Array<
		{ readonly smoothing: 3 | 7 | null } & TrendBucket<MeasurementTrend["points"][number]>
	> = buckets.map((bucket) => ({ ...bucket, smoothing: null }));
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
		const grid = trendGrid(trend, timeZone);
		const buckets = smooth
			? smoothMeasurementBuckets(grid.buckets)
			: grid.buckets.map((bucket) => ({ ...bucket, smoothing: null }));
		return {
			...grid,
			buckets: buckets.map((bucket) =>
				Object.assign({}, bucket, {
					detail:
						bucket.source === null
							? "No readings"
							: `${bucket.source.readings} readings; grouped average${bucket.smoothing === null ? "" : `; ${bucket.smoothing}-point smoothing`}`,
				}),
			),
		};
	};
	const currentGrid = build(current);
	const previousGrid = previous === null ? null : build(previous);
	const units = new Set(
		[...current.points, ...(previous?.points ?? [])].map((point) => point.unit),
	);
	const comparable =
		units.size <= 1 &&
		previous?.metricId === current.metricId &&
		previous.grouping === current.grouping;
	return {
		...pairTrendBuckets(currentGrid.buckets, comparable ? (previousGrid?.buckets ?? []) : []),
		current: currentGrid,
		previous: previousGrid,
		mixedUnits: units.size > 1,
		unit: units.size === 1 ? ([...units][0] ?? null) : null,
		partial: currentGrid.partial || (previousGrid?.partial ?? false),
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
) => {
	const grid = trendGrid(trend, timeZone, 0);
	const first = grid.buckets[0];
	const last = grid.buckets.at(-1);
	const displayedPeriod =
		first === undefined || last === undefined
			? null
			: calendarPeriod(first.period.startDate, last.period.endDate, timeZone);
	return {
		...grid,
		displayedPeriod,
		clipped: trend.clipped ?? false,
		periodCaption: periodCaption(displayedPeriod ?? trend.period),
		days: grid.buckets.flatMap(({ value, period }) =>
			value === null ? [] : [{ value, date: period.startDate }],
		),
	};
};
