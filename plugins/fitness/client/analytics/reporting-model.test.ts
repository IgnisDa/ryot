import { PluginId, resolveReportingSelection, TimeZone } from "@ryot-app/plugin-client-sdk/plugin";
import { describe, expect, it } from "vitest";

import {
	type AnalyticsInput,
	type AnalyticsTrend,
	consistencyModel,
	type MeasurementTrend,
	measurementTrendModel,
	metricDisplay,
	trendBuckets,
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
	grouping: "day",
	metric: "workouts",
	processing: "ready",
	period: customPeriod("2024-02-28", "2024-03-02"),
	...overrides,
});
const point = (at: string, value: null | number): AnalyticsTrend["points"][number] => ({
	at,
	value,
	observations: 1,
	knownValues: value === null ? 0 : 1,
});
const measurement = (
	points: MeasurementTrend["points"],
	overrides: Partial<MeasurementTrend> = {},
): MeasurementTrend => ({
	points,
	grouping: "day",
	metricId: "weight",
	period: customPeriod("2024-02-28", "2024-03-02"),
	...overrides,
});

describe("trend buckets", () => {
	it("keeps unknown derived buckets distinct from zero counts", () => {
		expect(trendBuckets(trend(), TimeZone.make("UTC"), 0).map(({ value }) => value)).toEqual([
			0, 0, 0, 0,
		]);
		const buckets = trendBuckets(
			trend({
				metric: "volume",
				points: [point("2024-02-29T00:00:00Z", 0), point("2024-03-01T00:00:00Z", null)],
			}),
			TimeZone.make("UTC"),
		);
		expect(buckets.map(({ value }) => value)).toEqual([null, 0, null, null]);
		expect(buckets[2]?.source?.value).toBeNull();
		expect(buckets[0]?.detail).toBe("No known value");
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
	});
	it("converts both workout periods without replacing prior dates or unknown volume", () => {
		const model = workoutTrendModel(
			trend({ metric: "volume", points: [point("2024-02-28T00:00:00Z", 0.45359237)] }),
			trend({
				metric: "volume",
				points: [point("2024-02-24T00:00:00Z", 0)],
				period: customPeriod("2024-02-24", "2024-02-27"),
			}),
			TimeZone.make("UTC"),
			{ energyUnit: "kcal", unitSystem: "imperial" },
		);
		expect(model.current[0]?.value).toBe(1);
		expect(model.previous?.[0]).toMatchObject({ value: 0, period: { startDate: "2024-02-24" } });
		expect(model.current[1]?.value).toBeNull();
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
		const smooth = measurementTrendModel(data, null, TimeZone.make("UTC"), true).current;
		expect(smooth.map(({ value }) => value)).toEqual([0, 1, null, 8]);
		expect(smooth[1]?.source).toEqual(data.points[1]);
		expect(smooth[1]?.smoothing).toBe(3);
		expect(measurementTrendModel(data, null, TimeZone.make("UTC"), true).current[1]?.detail).toBe(
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
		const smooth = measurementTrendModel(data, null, TimeZone.make("UTC"), true).current;
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
		expect(model.previous).toBeNull();
	});
});

describe("workout consistency", () => {
	it("fills every day of the period with zero for days without workouts", () => {
		const model = consistencyModel(
			trend({ period: customPeriod("2023-09-03", "2024-03-02", input.timeZone) }),
			input.timeZone,
		);
		expect(model.days).toHaveLength(182);
		expect(model.days[0]?.value).toBe(0);
		expect(model.periodCaption).toBe("2023-09-03 – 2024-03-02");
	});
	it("places recorded workouts on their local day", () => {
		const model = consistencyModel(
			trend({ points: [point("2024-02-29T00:00:00Z", 2)] }),
			TimeZone.make("UTC"),
		);
		expect(model.days).toEqual([
			{ value: 0, date: "2024-02-28" },
			{ value: 2, date: "2024-02-29" },
			{ value: 0, date: "2024-03-01" },
			{ value: 0, date: "2024-03-02" },
		]);
	});
});
