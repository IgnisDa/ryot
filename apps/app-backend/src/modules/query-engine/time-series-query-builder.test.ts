import { describe, expect, it } from "bun:test";

import { alignDateRangeToBucket, buildBucketInterval } from "./time-series-query-builder";

describe("buildBucketInterval", () => {
	it("maps hour to '1 hour'", () => {
		expect(buildBucketInterval("hour")).toBe("1 hour");
	});

	it("maps day to '1 day'", () => {
		expect(buildBucketInterval("day")).toBe("1 day");
	});

	it("maps week to '1 week'", () => {
		expect(buildBucketInterval("week")).toBe("1 week");
	});

	it("maps month to '1 month'", () => {
		expect(buildBucketInterval("month")).toBe("1 month");
	});
});

describe("alignDateRangeToBucket", () => {
	it("expands a single partial day range to the full day bucket", () => {
		expect(
			alignDateRangeToBucket({
				bucket: "day",
				dateRange: {
					startAt: "2026-04-30T10:00:00.000Z",
					endAt: "2026-04-30T12:00:00.000Z",
				},
			}),
		).toEqual({
			startAt: "2026-04-30T00:00:00.000Z",
			endAt: "2026-05-01T00:00:00.000Z",
		});
	});

	it("preserves whole-day boundaries when already aligned", () => {
		expect(
			alignDateRangeToBucket({
				bucket: "day",
				dateRange: {
					startAt: "2026-04-30T00:00:00.000Z",
					endAt: "2026-05-03T00:00:00.000Z",
				},
			}),
		).toEqual({
			startAt: "2026-04-30T00:00:00.000Z",
			endAt: "2026-05-03T00:00:00.000Z",
		});
	});

	it("aligns a partial hour range to the surrounding hour boundaries", () => {
		expect(
			alignDateRangeToBucket({
				bucket: "hour",
				dateRange: {
					endAt: "2026-04-30T11:45:00.000Z",
					startAt: "2026-04-30T10:30:00.000Z",
				},
			}),
		).toEqual({
			endAt: "2026-04-30T12:00:00.000Z",
			startAt: "2026-04-30T10:00:00.000Z",
		});
	});

	it("preserves whole-hour boundaries when already aligned", () => {
		expect(
			alignDateRangeToBucket({
				bucket: "hour",
				dateRange: {
					endAt: "2026-04-30T11:00:00.000Z",
					startAt: "2026-04-30T08:00:00.000Z",
				},
			}),
		).toEqual({
			endAt: "2026-04-30T11:00:00.000Z",
			startAt: "2026-04-30T08:00:00.000Z",
		});
	});

	it("aligns a partial week range to the surrounding week boundaries", () => {
		// 2026-04-30 is a Thursday; week start (dayjs default: Sunday) = 2026-04-26
		expect(
			alignDateRangeToBucket({
				bucket: "week",
				dateRange: {
					endAt: "2026-04-30T12:00:00.000Z",
					startAt: "2026-04-30T10:00:00.000Z",
				},
			}),
		).toEqual({
			endAt: "2026-05-03T00:00:00.000Z",
			startAt: "2026-04-26T00:00:00.000Z",
		});
	});

	it("spans two week boundaries when the range crosses a week boundary", () => {
		// 2026-04-28 is Tuesday (week start: 2026-04-26 Sun)
		// 2026-05-05 is Tuesday of next week (week start: 2026-05-03 Sun)
		expect(
			alignDateRangeToBucket({
				bucket: "week",
				dateRange: {
					endAt: "2026-05-04T00:00:00.000Z",
					startAt: "2026-04-28T00:00:00.000Z",
				},
			}),
		).toEqual({
			endAt: "2026-05-10T00:00:00.000Z",
			startAt: "2026-04-26T00:00:00.000Z",
		});
	});

	it("aligns a partial month range to the surrounding month boundaries", () => {
		expect(
			alignDateRangeToBucket({
				bucket: "month",
				dateRange: {
					endAt: "2026-04-20T12:00:00.000Z",
					startAt: "2026-04-15T10:00:00.000Z",
				},
			}),
		).toEqual({
			endAt: "2026-05-01T00:00:00.000Z",
			startAt: "2026-04-01T00:00:00.000Z",
		});
	});

	it("spans two month boundaries when the range crosses a month boundary", () => {
		expect(
			alignDateRangeToBucket({
				bucket: "month",
				dateRange: {
					endAt: "2026-04-10T00:00:00.000Z",
					startAt: "2026-03-20T00:00:00.000Z",
				},
			}),
		).toEqual({
			endAt: "2026-05-01T00:00:00.000Z",
			startAt: "2026-03-01T00:00:00.000Z",
		});
	});
});
