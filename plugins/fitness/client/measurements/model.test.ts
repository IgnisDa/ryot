import { TimeZone } from "@ryot-app/plugin-client-sdk/plugin";
import { describe, expect, it } from "vitest";

import { buildMetricRows, rollingAverage, sortMetricRows } from "../../shared/measurement-metrics";
import type { MeasurementSummary } from "../../shared/measurement-recipes";
import { measurementTrendModel } from "../analytics/reporting-model";
import {
	formatChange,
	formatValue,
	groupByMonth,
	groupReadings,
	measurementPeriod,
	selectPinnedMetrics,
	seriesWindow,
} from "./model";
import type { MeasurementLogEntry } from "./queries";

const now = new Date("2026-10-12T12:00:00.000Z");

const summary = (id: string, overrides: Partial<MeasurementSummary> = {}): MeasurementSummary => ({
	id,
	key: id,
	name: id,
	unit: "kg",
	rangeCount: 0,
	firstAt: null,
	latestAt: null,
	pinnedAt: null,
	latestValue: null,
	...overrides,
});

const points = (values: readonly number[]) =>
	values.map((value, index) => ({
		value,
		at: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
	}));

const reading = (
	id: string,
	metricId: string,
	value: number,
	occurredAt: string,
	comment: null | string = null,
): MeasurementLogEntry => ({
	id,
	comment,
	occurredAt,
	readings: [{ value, metricId, entryId: id, id: `${id}-reading` }],
});

describe("rollingAverage", () => {
	it("averages a trailing window of 3 for sparse series", () => {
		expect(rollingAverage(points([1, 2, 3, 4])).map(({ value }) => value)).toEqual([1, 1.5, 2, 3]);
	});

	it("widens the window to 7 once there are more than 40 points", () => {
		const values = Array.from({ length: 41 }, (_, index) => index);
		const trend = rollingAverage(points(values));
		expect(trend[6]?.value).toBe(3);
		expect(trend[40]?.value).toBe(37);
	});
});

describe("measurementPeriod and seriesWindow", () => {
	it("uses reporting days for fixed ranges and buckets by day", () => {
		expect(measurementPeriod("1M", now, TimeZone.make("UTC"))?.startAt).toBe(
			"2026-09-13T00:00:00.000Z",
		);
		expect(seriesWindow("1Y", now, [], TimeZone.make("UTC"))).toEqual({
			bucket: "day",
			endAt: "2026-10-13T00:00:00.000Z",
			startAt: "2025-10-13T00:00:00.000Z",
		});
	});

	it("starts All at the earliest reading and buckets by week", () => {
		const window = seriesWindow(
			"All",
			now,
			[
				summary("a", { firstAt: "2024-05-01T05:00:00.000Z" }),
				summary("b", { firstAt: "2023-02-01T05:00:00.000Z" }),
				summary("c"),
			],
			TimeZone.make("UTC"),
		);
		expect(window).toEqual({
			bucket: "week",
			endAt: now.toISOString(),
			startAt: "2023-02-01T05:00:00.000Z",
		});
	});

	it("keeps old observations in All by using coarser buckets", () => {
		const window = seriesWindow(
			"All",
			now,
			[summary("a", { firstAt: "1990-01-01T00:00:00.000Z" })],
			TimeZone.make("UTC"),
		);
		expect(window).toEqual({
			bucket: "month",
			endAt: now.toISOString(),
			startAt: "1990-01-01T00:00:00.000Z",
		});
	});
});

describe("buildMetricRows", () => {
	it("derives the trend change over the range and sorts out metrics without enough points", () => {
		const rows = buildMetricRows(
			[summary("weight"), summary("waist"), summary("hip")],
			[
				{ metricId: "weight", points: points([70, 72, 74]) },
				{ metricId: "waist", points: points([80]) },
			],
			{ bucket: "day", timeZone: TimeZone.make("UTC") },
		);
		expect(rows.map(({ change }) => change)).toEqual([2, null, null]);
		expect(rows[0]?.relativeChange).toBeCloseTo(2 / 70);
		expect(rows[1]?.relativeChange).toBeNull();
	});

	it.each([
		["day", "2026-01-01T05:00:00.000Z", "2026-01-05T05:00:00.000Z"],
		["day", "2026-03-08T05:00:00.000Z", "2026-03-09T04:00:00.000Z"],
		["day", "2026-11-01T04:00:00.000Z", "2026-11-02T05:00:00.000Z"],
		["week", "2026-03-02T05:00:00.000Z", "2026-03-16T04:00:00.000Z"],
		["month", "2026-01-01T05:00:00.000Z", "2026-03-01T05:00:00.000Z"],
	] as const)(
		"matches Analytics for Home and All Measurements %s buckets",
		(bucket, first, last) => {
			const timeZone = TimeZone.make("America/New_York");
			const averages = [
				{ value: 70, at: first },
				{ at: last, value: 74 },
			];
			const rows = buildMetricRows(
				[summary("weight")],
				[{ points: averages, metricId: "weight" }],
				{ bucket, timeZone },
			);
			const analytics = measurementTrendModel(
				{
					period: null,
					hasMore: false,
					grouping: bucket,
					metricId: "weight",
					points: averages.map((point) => Object.assign({}, point, { unit: "kg", readings: 1 })),
				},
				null,
				timeZone,
				true,
			);
			expect(
				rows[0]?.trend.filter(({ value }) => value !== null).map(({ value }) => value),
			).toEqual(analytics.current.filter(({ value }) => value !== null).map(({ value }) => value));
		},
	);
});

describe("selectPinnedMetrics", () => {
	it("keeps pinned metrics in pin order, breaking ties by id, up to the pin limit", () => {
		const pinned = selectPinnedMetrics([
			summary("a", { pinnedAt: "2026-10-03T00:00:00.000Z" }),
			summary("b"),
			summary("c", { pinnedAt: "2026-10-01T00:00:00.000Z" }),
			summary("e", { pinnedAt: "2026-10-02T00:00:00.000Z" }),
			summary("d", { pinnedAt: "2026-10-02T00:00:00.000Z" }),
		]);
		expect(pinned.map(({ id }) => id)).toEqual(["c", "d", "e"]);
	});
});

describe("sortMetricRows", () => {
	const rows = buildMetricRows(
		[
			summary("Weight", { rangeCount: 4, latestAt: "2026-10-08T00:00:00.000Z" }),
			summary("Body fat", { rangeCount: 4, latestAt: "2026-10-09T00:00:00.000Z" }),
			summary("Waist", { latestAt: null }),
		],
		[
			{ metricId: "Weight", points: points([100, 100, 100, 110]) },
			{ metricId: "Body fat", points: points([20, 20, 20, 21]) },
		],
		{ bucket: "day", timeZone: TimeZone.make("UTC") },
	);

	it.each([
		["recent", ["Body fat", "Weight", "Waist"]],
		["az", ["Body fat", "Waist", "Weight"]],
		["changed", ["Weight", "Body fat", "Waist"]],
	] as const)("orders by %s", (sort, expected) => {
		expect(sortMetricRows(rows, sort).map(({ summary: { name } }) => name)).toEqual(expected);
	});
});

describe("formatting", () => {
	it("attaches percent without a space and other units with one", () => {
		expect(formatValue(73.6, "kg")).toBe("73.6 kg");
		expect(formatValue(18.25, "%")).toBe("18.25%");
		expect(formatValue(7, null)).toBe("7");
	});

	it("signs changes and treats a rounded-away change as zero", () => {
		expect(formatChange(1.5, "kg")).toBe("+1.5 kg");
		expect(formatChange(-0.5, "%")).toBe("−0.5%");
		expect(formatChange(0.001, "kg")).toBe("±0 kg");
	});
});

describe("groupReadings", () => {
	const readings = [
		reading("r5", "weight", 73.6, "2026-10-08T04:38:00.000Z", "after run"),
		reading("r3", "weight", 73.1, "2026-09-30T05:00:00.000Z"),
		reading("r2", "weight", 73.1, "2026-09-02T05:00:00.000Z"),
	];

	it("keeps entry identity and diffs against each metric's previous entry", () => {
		const groups = groupReadings(readings);
		expect(groups.map(({ occurredAt }) => occurredAt)).toEqual([
			"2026-10-08T04:38:00.000Z",
			"2026-09-30T05:00:00.000Z",
			"2026-09-02T05:00:00.000Z",
		]);
		expect(groups[0]?.comment).toBe("after run");
		expect(groups[0]?.values.get("weight")).toMatchObject({ value: 73.6, previous: 73.1 });
		expect(groups[2]?.values.get("weight")?.previous).toBeNull();
	});

	it("preserves equal-time submissions with the same metric and separate comments", () => {
		const at = "2026-10-08T04:38:00.000Z";
		const groups = groupReadings([
			reading("first", "weight", 70, at, "Morning"),
			reading("second", "weight", 72, at, "After run"),
		]);
		expect(
			groups.map(({ id, values, comment }) => ({
				id,
				comment,
				value: values.get("weight")?.value,
			})),
		).toEqual([
			{ value: 70, id: "first", comment: "Morning" },
			{ value: 72, id: "second", comment: "After run" },
		]);
	});

	it("groups consecutive readings into month sections in the given time zone", () => {
		const sections = groupByMonth(groupReadings(readings), TimeZone.make("UTC"));
		expect(sections.map(({ label, groups }) => [label, groups.length])).toEqual([
			["October 2026", 1],
			["September 2026", 2],
		]);
		expect(
			groupByMonth(
				groupReadings([reading("x", "weight", 1, "2026-09-30T20:00:00.000Z")]),
				TimeZone.make("Asia/Kolkata"),
			)[0]?.label,
		).toBe("October 2026");
	});
});
