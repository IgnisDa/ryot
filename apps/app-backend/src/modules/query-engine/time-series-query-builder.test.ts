import { describe, expect, it } from "vitest";

import {
	alignDateRangeToBucket,
	buildBucketInterval,
	normalizeBucketDate,
} from "./time-series-query-builder";

describe("buildBucketInterval", () => {
	it.each([
		["hour", "1 hour"],
		["day", "1 day"],
		["week", "1 week"],
		["month", "1 month"],
	] as const)("maps %s to %s", (bucket, interval) => {
		expect(buildBucketInterval(bucket)).toBe(interval);
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
		expect(
			alignDateRangeToBucket({
				bucket: "week",
				dateRange: {
					endAt: "2026-04-30T12:00:00.000Z",
					startAt: "2026-04-30T10:00:00.000Z",
				},
			}),
		).toEqual({
			endAt: "2026-05-04T00:00:00.000Z",
			startAt: "2026-04-27T00:00:00.000Z",
		});
	});

	it("spans two week boundaries when the range crosses a week boundary", () => {
		expect(
			alignDateRangeToBucket({
				bucket: "week",
				dateRange: {
					endAt: "2026-05-05T00:00:00.000Z",
					startAt: "2026-04-28T00:00:00.000Z",
				},
			}),
		).toEqual({
			endAt: "2026-05-11T00:00:00.000Z",
			startAt: "2026-04-27T00:00:00.000Z",
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

describe("normalizeBucketDate", () => {
	it("formats postgres timestamp strings as ISO UTC", () => {
		expect(normalizeBucketDate("2026-06-19 00:00:00")).toBe("2026-06-19T00:00:00.000Z");
	});
});
