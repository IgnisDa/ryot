import { PluginId, resolveReportingSelection, TimeZone } from "@ryot-app/plugin-client-sdk/plugin";
import { describe, expect, it } from "vitest";

import {
	type AnalyticsInput,
	type AnalyticsTrend,
	compareQuantities,
	comparisonCaption,
	consistencyModel,
	consistencySelection,
	formatExactValue,
	type MeasurementTrend,
	measurementTrendModel,
	metricDisplay,
	pairTrendBuckets,
	periodCaption,
	reportingExecution,
	selectionForPeriod,
	smoothMeasurementBuckets,
	trendGrid,
	workoutTrendModel,
} from "./reporting-model";

const input: AnalyticsInput = {
	timeZone: TimeZone.make("America/New_York"),
	reference: { kind: "local", pluginId: PluginId.make("fitness-owner") },
	selection: {
		grouping: "day",
		comparison: "previous-period",
		range: { days: 7, kind: "rolling" },
	},
};
const customPeriod = (startDate: string, endDate: string, timeZone = TimeZone.make("UTC")) =>
	resolveReportingSelection(
		{ grouping: "day", comparison: "none", range: { endDate, startDate, kind: "custom" } },
		{ now: 0, timeZone },
	).current;
const trend = (overrides: Partial<AnalyticsTrend> = {}): AnalyticsTrend => ({
	points: [],
	hasMore: false,
	grouping: "day",
	unit: "workouts",
	metric: "workouts",
	period: customPeriod("2024-02-28", "2024-03-02"),
	...overrides,
});
const point = (at: string, value: null | number): AnalyticsTrend["points"][number] => ({
	at,
	value,
	failedSets: 0,
	pendingSets: 0,
	observations: 1,
	knownValues: value === null ? 0 : 1,
});
const measurement = (
	points: MeasurementTrend["points"],
	overrides: Partial<MeasurementTrend> = {},
): MeasurementTrend => ({
	points,
	hasMore: false,
	grouping: "day",
	metricId: "weight",
	period: customPeriod("2024-02-28", "2024-03-02"),
	...overrides,
});

describe("fitness reporting execution", () => {
	it("captures rolling and actual previous calendar dates across DST", () => {
		const now = Date.parse("2026-11-01T18:00:00Z");
		const reporting = reportingExecution(input, now);
		expect(reporting.now).toBe(now);
		expect(reporting.selection.range).toEqual({
			kind: "custom",
			endDate: "2026-11-01",
			startDate: "2026-10-26",
		});
		expect(reporting.resolved.current?.endAt).toBe("2026-11-02T05:00:00.000Z");
		expect(reporting.resolved.previous?.startDate).toBe("2026-10-19");
		expect(comparisonCaption(reporting)).toBe("2026-10-26 – 2026-11-01 vs 2026-10-19 – 2026-10-25");
		expect(selectionForPeriod(input.selection, reporting.resolved.previous).range).toEqual({
			kind: "custom",
			endDate: "2026-10-25",
			startDate: "2026-10-19",
		});
	});
	it("omits all-time bounds and unavailable comparisons", () => {
		const reporting = reportingExecution(
			{ ...input, selection: { ...input.selection, range: { kind: "all-time" } } },
			0,
		);
		expect(reporting.selection.range).toEqual({ kind: "all-time" });
		expect(reporting.resolved.current).toBeNull();
		expect(comparisonCaption(reporting)).toBeNull();
		expect(periodCaption(null)).toBe("All time");
	});
});

describe("calendar bucket grids", () => {
	it("resolves each local day independently at a DST transition", () => {
		const grid = trendGrid(
			trend({ period: customPeriod("2026-10-31", "2026-11-02", input.timeZone) }),
			input.timeZone,
			0,
		);
		expect(grid.buckets.map(({ period }) => [period.startAt, period.endAt])).toEqual([
			["2026-10-31T04:00:00.000Z", "2026-11-01T04:00:00.000Z"],
			["2026-11-01T04:00:00.000Z", "2026-11-02T05:00:00.000Z"],
			["2026-11-02T05:00:00.000Z", "2026-11-03T05:00:00.000Z"],
		]);
	});
	it("includes leap days and keeps unknown derived buckets distinct from zero counts", () => {
		expect(
			trendGrid(trend(), TimeZone.make("UTC"), 0).buckets.map(({ value, period }) => [
				period.startDate,
				value,
			]),
		).toEqual([
			["2024-02-28", 0],
			["2024-02-29", 0],
			["2024-03-01", 0],
			["2024-03-02", 0],
		]);
		const grid = trendGrid(
			trend({
				metric: "volume",
				points: [point("2024-02-29T00:00:00Z", 0), point("2024-03-01T00:00:00Z", null)],
			}),
			TimeZone.make("UTC"),
		);
		expect(grid.buckets.map(({ value }) => value)).toEqual([null, 0, null, null]);
		expect(grid.buckets[2]?.source?.value).toBeNull();
	});
	it("keeps unequal month and partial-week boundaries and pairs by ordinal, not date", () => {
		const current = trendGrid(
			trend({ grouping: "month", period: customPeriod("2024-02-15", "2024-03-02") }),
			TimeZone.make("UTC"),
		);
		expect(current.buckets.map(({ period }) => [period.startDate, period.endDate])).toEqual([
			["2024-02-15", "2024-02-29"],
			["2024-03-01", "2024-03-02"],
		]);
		expect(current.buckets[0]?.at).toBe("2024-02-15T00:00:00.000Z");
		const currentWeeks = trendGrid(
			trend({ grouping: "week", period: customPeriod("2026-03-04", "2026-03-10") }),
			TimeZone.make("UTC"),
		);
		const previousWeeks = trendGrid(
			trend({ grouping: "week", period: customPeriod("2026-02-15", "2026-03-03") }),
			TimeZone.make("UTC"),
		);
		const paired = pairTrendBuckets(currentWeeks.buckets, previousWeeks.buckets);
		expect(
			paired.buckets.map(({ period, comparison }) => [
				period.startDate,
				comparison?.period.startDate,
			]),
		).toEqual([
			["2026-03-04", "2026-02-15"],
			["2026-03-09", "2026-02-16"],
		]);
		expect(paired.extraPrevious.map(({ period }) => period.startDate)).toEqual([
			"2026-02-23",
			"2026-03-02",
		]);
	});
	it("does not fill an unseen tail or claim a truncated source is complete", () => {
		const grid = trendGrid(
			trend({ hasMore: true, points: [point("2024-02-29T00:00:00Z", 1)] }),
			TimeZone.make("UTC"),
			0,
		);
		expect(grid.buckets.map(({ value }) => value)).toEqual([0, 1]);
		expect(grid).toMatchObject({ partial: true, complete: false });
		expect(trendGrid(trend({ hasMore: true }), TimeZone.make("UTC"), 0).buckets).toEqual([]);
		const weekly = trendGrid(
			trend({
				hasMore: true,
				grouping: "week",
				points: [point("2026-03-02T00:00:00Z", 1)],
				period: customPeriod("2026-03-04", "2026-04-01"),
			}),
			TimeZone.make("UTC"),
			0,
		);
		expect(weekly.buckets[0]?.period.endDate).toBe("2026-03-08");
	});
	it("caps dense grids at 1000 without claiming completion", () => {
		const grid = trendGrid(
			trend({ period: customPeriod("2020-01-01", "2026-12-31") }),
			TimeZone.make("UTC"),
			0,
		);
		expect(grid.buckets).toHaveLength(1000);
		expect(grid).toMatchObject({ partial: true, complete: false });
	});
	it("does not invent all-time history before or after the returned buckets", () => {
		expect(trendGrid(trend({ period: null }), TimeZone.make("UTC"), 0).buckets).toEqual([]);
		const grid = trendGrid(
			trend({ period: null, points: [point("2024-02-29T00:00:00Z", 1)] }),
			TimeZone.make("UTC"),
			0,
		);
		expect(grid.buckets).toHaveLength(1);
		expect(grid.buckets[0]?.period.startDate).toBe("2024-02-29");
		const years = trendGrid(
			trend({ period: null, grouping: "year", points: [point("2024-01-01T00:00:00Z", 1)] }),
			TimeZone.make("UTC"),
			0,
		);
		expect(years.buckets[0]?.period).toMatchObject({
			endDate: "2024-12-31",
			startDate: "2024-01-01",
		});
	});
});

describe("exact quantities and comparisons", () => {
	it("keeps exact table decimals and storage-unit conversions", () => {
		const imperial = { energyUnit: "kJ", unitSystem: "imperial" } as const;
		expect(metricDisplay("volume", 0.45359237, imperial)).toEqual({ value: 1, unit: "lb × reps" });
		expect(metricDisplay("distance", 1.609344, imperial)).toEqual({ value: 1, unit: "mi" });
		expect(metricDisplay("calories", 1, imperial)).toEqual({ unit: "kJ", value: 4.184 });
		expect(metricDisplay("volume", null, imperial).value).toBeNull();
		expect(metricDisplay("volume", 1.234567, { ...imperial, unitSystem: "metric" })).toEqual({
			value: 1.234567,
			unit: "kg × reps",
		});
		expect(formatExactValue(1234.567891, "kg × reps")).toBe("1234.567891 kg × reps");
		expect(formatExactValue(0, null)).toBe("0");
		expect(formatExactValue(null, "seconds")).toBe("Unknown");
	});
	it("uses absolute new activity after zero and leaves missing comparisons unknown", () => {
		expect(compareQuantities(5, 0)).toEqual({ absolute: 5, percent: null, kind: "new-activity" });
		expect(compareQuantities(0, 0)).toEqual({ percent: 0, absolute: 0, kind: "change" });
		expect(compareQuantities(3, 2)).toEqual({ absolute: 1, percent: 50, kind: "change" });
		expect(compareQuantities(null, 0)).toEqual({ percent: null, absolute: null, kind: "unknown" });
		expect(compareQuantities(0, null).percent).toBeNull();
	});
	it("converts both workout periods without replacing prior dates or unknown volume", () => {
		const model = workoutTrendModel(
			trend({
				metric: "volume",
				unit: "kg × repetitions",
				points: [point("2024-02-28T00:00:00Z", 0.45359237)],
			}),
			trend({
				metric: "volume",
				unit: "kg × repetitions",
				points: [point("2024-02-24T00:00:00Z", 0)],
				period: customPeriod("2024-02-24", "2024-02-27"),
			}),
			TimeZone.make("UTC"),
			{ energyUnit: "kcal", unitSystem: "imperial" },
		);
		expect(model.buckets[0]).toMatchObject({
			value: 1,
			comparison: { value: 0, period: { startDate: "2024-02-24" } },
		});
		expect(model.buckets[1]?.value).toBeNull();
		expect(model.unit).toBe("lb × reps");
	});
});

describe("measurement averages", () => {
	it("preserves original averages and reading counts and restarts smoothing after gaps", () => {
		const data = measurement([
			{ value: 0, unit: "kg", readings: 2, at: "2024-02-28T00:00:00Z" },
			{ value: 2, unit: "kg", readings: 3, at: "2024-02-29T00:00:00Z" },
			{ value: 8, unit: "kg", readings: 1, at: "2024-03-02T00:00:00Z" },
		]);
		const grid = trendGrid(data, TimeZone.make("UTC"));
		const smooth = smoothMeasurementBuckets(grid.buckets);
		expect(smooth.map(({ value }) => value)).toEqual([0, 1, null, 8]);
		expect(smooth[1]?.source).toEqual(data.points[1]);
		expect(smooth[1]?.smoothing).toBe(3);
		expect(measurementTrendModel(data, null, TimeZone.make("UTC"), true).buckets[1]?.detail).toBe(
			"3 readings; grouped average; 3-point smoothing",
		);
	});
	it("labels seven-point smoothing for long continuous known runs", () => {
		const data = measurement(
			Array.from({ length: 45 }, (_, index) => ({
				unit: "kg",
				readings: 1,
				value: index,
				at: new Date(Date.UTC(2024, 0, index + 1)).toISOString(),
			})),
			{ period: customPeriod("2024-01-01", "2024-02-14") },
		);
		const smooth = smoothMeasurementBuckets(trendGrid(data, TimeZone.make("UTC")).buckets);
		expect(smooth.at(-1)).toMatchObject({ value: 41, smoothing: 7, source: { value: 44 } });
	});
	it("does not overlay measurements with different units", () => {
		const current = measurement([
			{ value: 1, unit: "kg", readings: 1, at: "2024-02-28T00:00:00Z" },
		]);
		const previous = measurement([
			{ value: 2, unit: "lb", readings: 1, at: "2024-02-28T00:00:00Z" },
		]);
		const model = measurementTrendModel(current, previous, TimeZone.make("UTC"));
		expect(model.mixedUnits).toBe(true);
		expect(model.buckets[0]?.comparison).toBeUndefined();
		expect(model.previous?.buckets[0]?.value).toBe(2);
	});
});

describe("bounded workout consistency", () => {
	it("clips all-time and long selections to the last 26 weeks, using the selected end", () => {
		const now = Date.parse("2026-11-01T18:00:00Z");
		const bounded = consistencySelection(
			{
				...input,
				selection: {
					...input.selection,
					range: { kind: "custom", endDate: "2024-03-02", startDate: "2020-01-01" },
				},
			},
			now,
		);
		expect(bounded.clipped).toBe(true);
		expect(bounded.selection.range).toEqual({
			kind: "custom",
			endDate: "2024-03-02",
			startDate: "2023-09-03",
		});
		const period = resolveReportingSelection(bounded.selection, {
			now,
			timeZone: input.timeZone,
		}).current;
		const model = consistencyModel(trend({ period }), input.timeZone);
		expect(model.days).toHaveLength(182);
		expect(model.days[0]?.value).toBe(0);
		expect(model.periodCaption).toBe("2023-09-03 – 2024-03-02");
		expect(
			consistencySelection(
				{ ...input, selection: { ...input.selection, range: { kind: "all-time" } } },
				now,
			).clipped,
		).toBe(true);
	});
	it("does not stretch short selections or hide incomplete consistency data", () => {
		const bounded = consistencySelection(input, Date.parse("2026-11-01T18:00:00Z"));
		expect(bounded.clipped).toBe(false);
		expect(bounded.selection.range).toEqual({
			kind: "custom",
			endDate: "2026-11-01",
			startDate: "2026-10-26",
		});
		const model = consistencyModel(
			trend({ hasMore: true, points: [point("2024-02-29T00:00:00Z", 2)] }),
			TimeZone.make("UTC"),
		);
		expect(model.days).toEqual([
			{ value: 0, date: "2024-02-28" },
			{ value: 2, date: "2024-02-29" },
		]);
		expect(model.partial).toBe(true);
	});
});
