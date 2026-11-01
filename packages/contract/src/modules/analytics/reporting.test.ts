import { describe, expect, it } from "vitest";

import { TimeZone } from "../../schema/time-zone";
import {
	calendarBuckets,
	defaultReportingSelection,
	parseReportingSearch,
	REPORTING_BUCKET_LIMIT,
	reportingExecution,
	type ReportingRange,
	reportingSearchParams,
	type ReportingSelection,
	resolveReportingSelection,
} from "./reporting";

const resolve = (
	range: ReportingRange,
	now = "2024-03-15T12:00:00Z",
	timeZone = TimeZone.make("America/New_York"),
) =>
	resolveReportingSelection(
		{ ...defaultReportingSelection, range },
		{ timeZone, now: Date.parse(now) },
	);

const grouped = (grouping: ReportingSelection["grouping"], range: ReportingRange) =>
	resolveReportingSelection(
		{ range, grouping, comparison: "none" },
		{ timeZone: TimeZone.make("UTC"), now: Date.parse("2024-03-15T12:00:00Z") },
	).grouping;
const searchOf = (params: Record<string, null | string>) =>
	new URLSearchParams(
		Object.entries(params).flatMap(([key, value]) => (value === null ? [] : [[key, value]])),
	).toString();
const points = (...at: string[]) => at.map((value) => ({ at: value }));

describe("reporting ranges", () => {
	it("uses calendar days across both DST transitions", () => {
		expect(
			resolve({ kind: "custom", endDate: "2024-03-10", startDate: "2024-03-10" }).current,
		).toEqual({
			endDate: "2024-03-10",
			startDate: "2024-03-10",
			endAt: "2024-03-11T04:00:00.000Z",
			startAt: "2024-03-10T05:00:00.000Z",
		});
		expect(
			resolve({ kind: "custom", endDate: "2024-11-03", startDate: "2024-11-03" }).current,
		).toEqual({
			endDate: "2024-11-03",
			startDate: "2024-11-03",
			endAt: "2024-11-04T05:00:00.000Z",
			startAt: "2024-11-03T04:00:00.000Z",
		});
	});
	it("resolves each custom boundary independently when local midnight is skipped", () => {
		const result = resolve(
			{ kind: "custom", endDate: "2024-09-08", startDate: "2024-09-08" },
			"2024-09-08T12:00:00Z",
			TimeZone.make("America/Santiago"),
		);
		expect(result.current).toEqual({
			endDate: "2024-09-08",
			startDate: "2024-09-08",
			endAt: "2024-09-09T03:00:00.000Z",
			startAt: "2024-09-08T04:00:00.000Z",
		});
		expect(result.previous).toEqual({
			endDate: "2024-09-07",
			startDate: "2024-09-07",
			endAt: "2024-09-08T04:00:00.000Z",
			startAt: "2024-09-07T04:00:00.000Z",
		});
	});
	it("ends rolling ranges at the next midnight when the clock is on a midnight-gap day", () => {
		const result = resolve(
			{ days: 7, kind: "rolling" },
			"2024-09-08T04:30:00Z",
			TimeZone.make("America/Santiago"),
		);
		expect(result.current).toEqual({
			endDate: "2024-09-08",
			startDate: "2024-09-02",
			endAt: "2024-09-09T03:00:00.000Z",
			startAt: "2024-09-02T04:00:00.000Z",
		});
		expect(result.previous).toEqual({
			endDate: "2024-09-01",
			startDate: "2024-08-26",
			endAt: "2024-09-02T04:00:00.000Z",
			startAt: "2024-08-26T04:00:00.000Z",
		});
	});
	it("does not carry a calendar month's midnight gap into other period boundaries", () => {
		const result = resolve(
			{ offset: 0, unit: "month", kind: "calendar" },
			"2012-04-15T12:00:00Z",
			TimeZone.make("America/Havana"),
		);
		expect(result.current).toEqual({
			endDate: "2012-04-30",
			startDate: "2012-04-01",
			endAt: "2012-05-01T04:00:00.000Z",
			startAt: "2012-04-01T05:00:00.000Z",
		});
		expect(result.previous).toEqual({
			endDate: "2012-03-31",
			startDate: "2012-03-01",
			endAt: "2012-04-01T05:00:00.000Z",
			startAt: "2012-03-01T05:00:00.000Z",
		});
		expect(
			resolve(
				{ offset: -1, unit: "month", kind: "calendar" },
				"2012-05-15T12:00:00Z",
				TimeZone.make("America/Havana"),
			).current,
		).toEqual(result.current);
	});
	it("compares full calendar months including leap days", () => {
		const result = resolve({ offset: 0, unit: "month", kind: "calendar" });
		expect(result.current).toEqual({
			endDate: "2024-03-31",
			startDate: "2024-03-01",
			endAt: "2024-04-01T04:00:00.000Z",
			startAt: "2024-03-01T05:00:00.000Z",
		});
		expect(result.previous).toEqual({
			endDate: "2024-02-29",
			startDate: "2024-02-01",
			endAt: "2024-03-01T05:00:00.000Z",
			startAt: "2024-02-01T05:00:00.000Z",
		});
		expect(resolve({ offset: -1, unit: "month", kind: "calendar" }).current).toEqual(
			result.previous,
		);
	});
	it("uses Monday weeks and whole calendar years", () => {
		expect(resolve({ offset: 0, unit: "week", kind: "calendar" }).current?.startDate).toBe(
			"2024-03-11",
		);
		const year = resolve({ offset: 0, unit: "year", kind: "calendar" });
		expect(year.current?.startDate).toBe("2024-01-01");
		expect(year.current?.endDate).toBe("2024-12-31");
		expect(year.previous?.endDate).toBe("2023-12-31");
	});
	it("resolves moving ranges from the supplied clock and pins the resolved period", () => {
		const first = reportingExecution(defaultReportingSelection, {
			timeZone: TimeZone.make("UTC"),
			now: Date.parse("2024-03-01T00:00:00Z"),
		});
		const next = resolve(
			defaultReportingSelection.range,
			"2024-03-02T00:00:00Z",
			TimeZone.make("UTC"),
		);
		expect(first.resolved.current?.endDate).toBe("2024-03-01");
		expect(next.current?.endDate).toBe("2024-03-02");
		expect(first.selection).toEqual({
			grouping: "day",
			comparison: "none",
			range: { kind: "custom", endDate: "2024-03-01", startDate: "2024-02-01" },
		});
	});
	it("coarsens long ranges and does not invent an all-time comparison", () => {
		expect(resolve({ days: 30, kind: "rolling" }).grouping).toBe("day");
		expect(resolve({ days: 365, kind: "rolling" }).grouping).toBe("week");
		expect(
			resolve({ kind: "custom", endDate: "2024-12-31", startDate: "2020-01-01" }).grouping,
		).toBe("month");
		expect(resolve({ kind: "all-time" })).toEqual({
			current: null,
			previous: null,
			grouping: "year",
			timeZone: TimeZone.make("America/New_York"),
		});
	});
	it("coarsens explicit groupings that would exceed the bucket limit", () => {
		expect(grouped("day", { offset: 0, unit: "year", kind: "calendar" })).toBe("day");
		expect(grouped("day", { kind: "custom", endDate: "2025-01-01", startDate: "2024-01-01" })).toBe(
			"week",
		);
		expect(
			grouped("week", { kind: "custom", endDate: "2031-12-31", startDate: "2024-01-01" }),
		).toBe("month");
		expect(grouped("day", { kind: "all-time" })).toBe("year");
		expect(REPORTING_BUCKET_LIMIT).toBeGreaterThanOrEqual(366);
	});
	it("round-trips flat URL selections and rejects invalid dates and reverse ranges", () => {
		const custom: ReportingSelection = {
			grouping: "week",
			comparison: "none",
			range: { kind: "custom", endDate: "2024-03-01", startDate: "2024-02-29" },
		};
		const calendar: ReportingSelection = {
			grouping: "auto",
			comparison: "previous-period",
			range: { offset: -1, unit: "month", kind: "calendar" },
		};
		expect(reportingSearchParams(custom)).toEqual({
			group: "week",
			range: "custom",
			compare: "none",
			end: "2024-03-01",
			start: "2024-02-29",
		});
		expect(parseReportingSearch(searchOf(reportingSearchParams(custom)))).toEqual(custom);
		expect(parseReportingSearch(searchOf(reportingSearchParams(calendar)))).toEqual(calendar);
		for (const [start, end] of [
			["2023-02-29", "2024-03-01"],
			["2024-04-01", "2024-03-01"],
		]) {
			expect(parseReportingSearch(`range=custom&start=${start}&end=${end}`).range).toEqual(
				defaultReportingSelection.range,
			);
		}
		expect(parseReportingSearch("range=invalid&group=hour&compare=yes")).toEqual(
			defaultReportingSelection,
		);
	});
});

describe("calendar buckets", () => {
	const newYork = TimeZone.make("America/New_York");
	const bucketDates = (
		grouping: "day" | "week" | "year" | "month",
		startDate: string,
		endDate: string,
		at: ReadonlyArray<{ readonly at: string }> = [],
	) =>
		calendarBuckets(at, {
			grouping,
			timeZone: newYork,
			at: (point) => point.at,
			period: resolve({ endDate, startDate, kind: "custom" }).current,
		}).map((bucket) => [bucket.date, bucket.points.length]);

	it("fills every local day, including DST-length days and leap days", () => {
		expect(
			bucketDates(
				"day",
				"2026-03-07",
				"2026-03-09",
				points("2026-03-08T05:00:00.000Z", "2026-03-09T04:00:00.000Z"),
			),
		).toEqual([
			["2026-03-07", 0],
			["2026-03-08", 1],
			["2026-03-09", 1],
		]);
		expect(
			bucketDates(
				"day",
				"2026-10-31",
				"2026-11-02",
				points("2026-11-01T04:00:00.000Z", "2026-11-02T05:00:00.000Z"),
			),
		).toEqual([
			["2026-10-31", 0],
			["2026-11-01", 1],
			["2026-11-02", 1],
		]);
		expect(bucketDates("day", "2024-02-28", "2024-03-01").map(([date]) => date)).toEqual([
			"2024-02-28",
			"2024-02-29",
			"2024-03-01",
		]);
	});

	it("starts partial weeks, months, and years at calendar boundaries and clips periods", () => {
		expect(bucketDates("week", "2026-03-04", "2026-03-10")).toEqual([
			["2026-03-02", 0],
			["2026-03-09", 0],
		]);
		expect(bucketDates("month", "2026-03-15", "2026-04-02").map(([date]) => date)).toEqual([
			"2026-03-01",
			"2026-04-01",
		]);
		const years = calendarBuckets([], {
			at: () => "",
			grouping: "year",
			timeZone: newYork,
			period: resolve({ kind: "custom", endDate: "2025-03-01", startDate: "2024-06-15" }).current,
		});
		expect(
			years.map((bucket) => [bucket.date, bucket.period.startDate, bucket.period.endDate]),
		).toEqual([
			["2024-01-01", "2024-06-15", "2024-12-31"],
			["2025-01-01", "2025-01-01", "2025-03-01"],
		]);
	});

	it("spans all-time buckets over the points' extent and keeps date-only points unshifted", () => {
		const buckets = calendarBuckets(points("2025-07-01", "2023-01-01T05:00:00.000Z"), {
			period: null,
			grouping: "year",
			timeZone: newYork,
			at: (point) => point.at,
		});
		expect(buckets.map((bucket) => [bucket.date, bucket.points.length])).toEqual([
			["2023-01-01", 1],
			["2024-01-01", 0],
			["2025-01-01", 1],
		]);
		expect(
			calendarBuckets([], { at: String, period: null, grouping: "year", timeZone: newYork }),
		).toEqual([]);
	});
});
