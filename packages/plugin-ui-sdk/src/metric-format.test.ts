import { describe, expect, it } from "bun:test";

import { testFormatters, testKernelText } from "@ryot-app/kernel-messages/testing";

import {
	axisTicks,
	countUnit,
	durationUnit,
	formatClock,
	formatDuration,
	measureUnit,
	metricDelta,
	metricFormat,
	percentUnit,
	ratingUnit,
} from "./metric-format";

const { metricParts, formatMetric, formatRating, formatAxisValue } = metricFormat(
	testKernelText,
	testFormatters,
);
const plural = (one: string, other: string) => countUnit((count) => (count === 1 ? one : other));

describe("formatMetric", () => {
	it("shows stored ratings in the chosen scale", () => {
		expect<string>(formatMetric(72.5, ratingUnit("hundred"))).toBe("72.5 / 100");
		expect<string>(formatMetric(73, ratingUnit("ten"))).toBe("7.3 / 10");
		expect<string>(formatMetric(70, ratingUnit("five"))).toBe("3.5 / 5");
		expect<string>(formatMetric(80, ratingUnit("three-point"))).toBe("Happy");
		expect(ratingUnit("ten")).toBe(ratingUnit("ten"));
	});

	it("formats one canonical label per scale", () => {
		expect<string>(formatRating(72, "hundred")).toBe("72");
		expect<string>(formatRating(66.66, "hundred")).toBe("66.7");
		expect<string>(formatRating(70, "ten")).toBe("7.0");
		expect<string>(formatRating(73, "ten")).toBe("7.3");
		expect<string>(formatRating(70, "five")).toBe("3.5");
		expect<string>(formatRating(0, "five")).toBe("0.0");
		expect<string[]>([0, 50, 100].map((rating) => formatRating(rating, "three-point"))).toEqual([
			"Sad",
			"Neutral",
			"Happy",
		]);
	});

	it("groups digits, trims precision by magnitude, and agrees count nouns with the value", () => {
		const titles = plural("title", "titles");
		expect<string>(formatMetric(63213, titles)).toBe("63,213 titles");
		expect<string>(formatMetric(1, titles)).toBe("1 title");
		expect<string>(formatMetric(-0, titles)).toBe("0 titles");
		expect<string>(formatMetric(12.3456, plural("entry", "entries"))).toBe("12.3 entries");
		expect<string>(formatMetric(1.23456, measureUnit("km"))).toBe("1.23 km");
		expect<string>(formatMetric(132603.111, measureUnit("pages"))).toBe("132,603 pages");
		expect<string>(formatMetric(-13.1862, percentUnit)).toBe("-13.2%");
		expect<string>(formatMetric(null, titles)).toBe("Unknown");
		expect<string>(formatMetric(Number.NaN, titles)).toBe("Unknown");
	});

	it("renders durations in their largest units", () => {
		const seconds = durationUnit("seconds");
		expect<string>(formatMetric(45, seconds)).toBe("45s");
		expect<string>(formatMetric(750, seconds)).toBe("12m 30s");
		expect<string>(formatMetric(720, seconds)).toBe("12m");
		expect<string>(formatMetric(89239, seconds)).toBe("24h 47m");
		expect<string>(formatMetric(-120, seconds)).toBe("-2m");
		expect<string>(formatMetric(490999.71, durationUnit("minutes"))).toBe("8,183h");
	});
});

describe("formatDuration", () => {
	it("rounds to the smallest unit without padding empty units", () => {
		expect(
			[0, 59, 60, 66, 61.5].map((minutes) =>
				formatDuration(testFormatters, minutes * 60, "minute"),
			),
		).toEqual(["0m", "59m", "1h", "1h 6m", "1h 2m"]);
		expect([0, 0.4, 61, 7500].map((seconds) => formatDuration(testFormatters, seconds))).toEqual([
			"0s",
			"0s",
			"1m 1s",
			"2h 5m",
		]);
	});
});

describe("formatClock", () => {
	it("pads minutes and seconds and adds hours from an hour on", () => {
		expect([0, 9.9, 59, 222, 3600, 3735, -5].map(formatClock)).toEqual([
			"0:00",
			"0:09",
			"0:59",
			"3:42",
			"1:00:00",
			"1:02:15",
			"0:00",
		]);
	});
});

describe("metricParts", () => {
	it("separates the figure from its unit and marks unknown values with a dash", () => {
		expect(metricParts(1771, plural("title", "titles"))).toEqual({
			value: "1,771",
			unit: "titles",
		});
		expect(metricParts(397770, measureUnit("kg × reps"))).toEqual({
			value: "397,770",
			unit: "kg × reps",
		});
		expect(metricParts(3600, durationUnit("seconds"))).toEqual({ unit: "", value: "1h" });
		expect(metricParts(null, plural("title", "titles"))).toEqual({ unit: "", value: "—" });
	});
});

describe("formatAxisValue", () => {
	it("abbreviates large numbers without count nouns and scales durations", () => {
		expect<string>(formatAxisValue(12500, plural("set", "sets"))).toBe("12.5K");
		expect<string>(formatAxisValue(5400, durationUnit("seconds"))).toBe("1.5h");
		expect<string>(formatAxisValue(30, durationUnit("minutes"))).toBe("30m");
		expect<string>(formatAxisValue(20, durationUnit("seconds"))).toBe("20s");
		expect<string>(formatAxisValue(40, percentUnit)).toBe("40%");
	});
});

describe("axisTicks", () => {
	it("covers the data from zero with whole steps for counts", () => {
		expect(axisTicks(0, 1, plural("review", "reviews"), 5)).toEqual([0, 1]);
		expect(axisTicks(0, 3, plural("review", "reviews"), 4)).toEqual([0, 1, 2, 3]);
		expect(axisTicks(0, 347, plural("entry", "entries"), 4)).toEqual([0, 100, 200, 300, 400]);
		expect(axisTicks(0, 1, measureUnit("km"), 4)).toEqual([0, 0.25, 0.5, 0.75, 1]);
		expect(axisTicks(-5, 10, measureUnit("kg"), 3)).toEqual([-5, 0, 5, 10]);
	});
});

describe("metricDelta", () => {
	it("compares with the previous value and separates new activity from unknown values", () => {
		expect(metricDelta(5, -10)).toEqual({ absolute: 15, percent: 150, kind: "change" });
		expect(metricDelta(0, 0)).toEqual({ percent: 0, absolute: 0, kind: "change" });
		expect(metricDelta(5, 0)).toEqual({ kind: "new", absolute: 5 });
		expect(metricDelta(null, 1)).toEqual({ kind: "unavailable" });
	});
});
