import { describe, expect, it } from "vitest";

import { TimeZone } from "../../schema/time-zone";
import {
	defaultReportingSelection,
	parseReportingSelection,
	type ReportingRange,
	reportingSelectionKey,
	reportingSelectionSearch,
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
	it("resolves moving ranges from the supplied clock without changing selection keys", () => {
		const selection = defaultReportingSelection;
		const key = reportingSelectionKey(selection, TimeZone.make("UTC"));
		const first = resolve(selection.range, "2024-03-01T00:00:00Z", TimeZone.make("UTC"));
		const next = resolve(selection.range, "2024-03-02T00:00:00Z", TimeZone.make("UTC"));
		expect(first.current?.endDate).toBe("2024-03-01");
		expect(next.current?.endDate).toBe("2024-03-02");
		expect(reportingSelectionKey(selection, TimeZone.make("UTC"))).toEqual(key);
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
	it("round-trips URL selections and rejects invalid dates and reverse ranges", () => {
		const selection = {
			...defaultReportingSelection,
			range: { kind: "custom", endDate: "2024-03-01", startDate: "2024-02-29" },
		} as const;
		expect(parseReportingSelection(reportingSelectionSearch(selection))).toEqual(selection);
		for (const range of [
			{ kind: "custom", endDate: "2024-03-01", startDate: "2023-02-29" },
			{ kind: "custom", endDate: "2024-03-01", startDate: "2024-04-01" },
		]) {
			expect(
				parseReportingSelection(
					new URLSearchParams({ reporting: JSON.stringify({ ...selection, range }) }).toString(),
				),
			).toEqual(defaultReportingSelection);
		}
		expect(parseReportingSelection("reporting=invalid")).toEqual(defaultReportingSelection);
	});
});
