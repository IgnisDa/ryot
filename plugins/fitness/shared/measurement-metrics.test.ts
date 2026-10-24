import { TimeZone } from "@ryot-app/plugin-kit/schema";
import { describe, expect, it } from "vitest";

import { buildMetricRows, smoothMeasurementSeries } from "./measurement-metrics";
import type { MeasurementSummary } from "./measurement-recipes";

const summary: MeasurementSummary = {
	id: "custom",
	key: "custom",
	unit: "mg/dL",
	rangeCount: 5,
	name: "Custom",
	latestValue: 74,
	firstAt: "2026-01-01T00:00:00.000Z",
	latestAt: "2026-01-05T00:00:00.000Z",
	pinnedAt: "2026-01-01T00:00:00.000Z",
};

describe("measurement calendar smoothing", () => {
	it("restarts after missing daily buckets and retains source averages and custom units", () => {
		const averages = [
			{ value: 70, at: "2026-01-01T00:00:00.000Z" },
			{ value: 74, at: "2026-01-05T00:00:00.000Z" },
		];
		const rows = buildMetricRows([summary], [{ points: averages, metricId: summary.id }], {
			bucket: "day",
			timeZone: TimeZone.make("UTC"),
		});
		expect(rows[0]?.trend).toEqual([
			averages[0],
			{ value: null, at: "2026-01-03T00:00:00.000Z" },
			averages[1],
		]);
		expect(rows[0]?.change).toBe(4);
		expect(rows[0]?.averages).toBe(averages);
		expect(rows[0]?.summary).toBe(summary);
	});

	it("keeps the existing trailing mean for continuous buckets", () => {
		const points = [70, 72, 74, 76].map((value, index) => ({
			value,
			at: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
		}));
		expect(
			smoothMeasurementSeries(points, { bucket: "day", timeZone: TimeZone.make("UTC") }).map(
				({ value }) => value,
			),
		).toEqual([70, 71, 72, 74]);
	});

	it("keeps known zero in its run and restarts at explicit null", () => {
		const points = [0, 2, null, 8, 0].map((value, index) => ({
			value,
			at: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
		}));
		expect(
			smoothMeasurementSeries(points, { bucket: "day", timeZone: TimeZone.make("UTC") }).map(
				({ value }) => value,
			),
		).toEqual([0, 1, null, 8, 4]);
		expect(points.map(({ value }) => value)).toEqual([0, 2, null, 8, 0]);
	});

	it.each([
		["23-hour", "2026-03-08T05:00:00.000Z", "2026-03-09T04:00:00.000Z"],
		["25-hour", "2026-11-01T04:00:00.000Z", "2026-11-02T05:00:00.000Z"],
	])("continues adjacent New York reporting days across a %s day", (_, first, second) => {
		expect(
			smoothMeasurementSeries(
				[
					{ at: first, value: 70 },
					{ value: 74, at: second },
				],
				{ bucket: "day", timeZone: TimeZone.make("America/New_York") },
			).map(({ value }) => value),
		).toEqual([70, 72]);
	});

	it.each([
		["week", "2026-03-02T05:00:00.000Z", "2026-03-09T04:00:00.000Z", "2026-03-23T04:00:00.000Z"],
		["month", "2026-01-01T05:00:00.000Z", "2026-02-01T05:00:00.000Z", "2026-04-01T04:00:00.000Z"],
		["year", "2023-01-01T05:00:00.000Z", "2024-01-01T05:00:00.000Z", "2026-01-01T05:00:00.000Z"],
	] as const)("uses calendar adjacency for %s buckets", (bucket, first, second, afterGap) => {
		const trend = smoothMeasurementSeries(
			[
				{ at: first, value: 70 },
				{ value: 74, at: second },
				{ value: 80, at: afterGap },
			],
			{ bucket, timeZone: TimeZone.make("America/New_York") },
		);
		expect(trend.map(({ value }) => value)).toEqual([70, 72, null, 80]);
	});

	it("keeps seven-point smoothing within long runs and sizes the next run independently", () => {
		const points = Array.from({ length: 45 }, (_, index) => ({
			value: index,
			at: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
		}));
		const trend = smoothMeasurementSeries(
			[
				...points,
				{ value: 8, at: "2026-03-01T00:00:00.000Z" },
				{ value: 12, at: "2026-03-02T00:00:00.000Z" },
			],
			{ bucket: "day", timeZone: TimeZone.make("UTC") },
		);
		expect(trend[6]?.value).toBe(3);
		expect(trend[44]?.value).toBe(41);
		expect(trend.slice(45).map(({ value }) => value)).toEqual([null, 8, 10]);
	});

	it("adds only one chart break for an arbitrarily long missing span", () => {
		const trend = smoothMeasurementSeries(
			[
				{ value: 0, at: "1990-01-01" },
				{ value: 74, at: "2026-01-01" },
			],
			{ bucket: "month", timeZone: TimeZone.make("America/New_York") },
		);
		expect(trend.map(({ value }) => value)).toEqual([0, null, 74]);
	});
});
