import { describe, expect, it } from "vitest";

import {
	axisTicks,
	countUnit,
	durationUnit,
	formatAxisValue,
	formatMetric,
	measureUnit,
	metricDelta,
	metricParts,
	percentUnit,
} from "./metric-format";

describe("formatMetric", () => {
	it("groups digits, trims precision by magnitude, and agrees count nouns with the value", () => {
		const titles = countUnit("title");
		expect(formatMetric(63213, titles)).toBe("63,213 titles");
		expect(formatMetric(1, titles)).toBe("1 title");
		expect(formatMetric(-0, titles)).toBe("0 titles");
		expect(formatMetric(12.3456, countUnit("entry", "entries"))).toBe("12.3 entries");
		expect(formatMetric(1.23456, measureUnit("km"))).toBe("1.23 km");
		expect(formatMetric(132603.111, measureUnit("pages"))).toBe("132,603 pages");
		expect(formatMetric(-13.1862, percentUnit)).toBe("-13.2%");
		expect(formatMetric(null, titles)).toBe("Unknown");
		expect(formatMetric(Number.NaN, titles)).toBe("Unknown");
	});

	it("renders durations in their largest units", () => {
		const seconds = durationUnit("seconds");
		expect(formatMetric(45, seconds)).toBe("45s");
		expect(formatMetric(750, seconds)).toBe("12m 30s");
		expect(formatMetric(720, seconds)).toBe("12m");
		expect(formatMetric(89239, seconds)).toBe("24h 47m");
		expect(formatMetric(-120, seconds)).toBe("-2m");
		expect(formatMetric(490999.71, durationUnit("minutes"))).toBe("8,183h");
	});
});

describe("metricParts", () => {
	it("separates the figure from its unit and marks unknown values with a dash", () => {
		expect(metricParts(1771, countUnit("title"))).toEqual({ value: "1,771", unit: "titles" });
		expect(metricParts(397770, measureUnit("kg × reps"))).toEqual({
			value: "397,770",
			unit: "kg × reps",
		});
		expect(metricParts(3600, durationUnit("seconds"))).toEqual({ unit: "", value: "1h" });
		expect(metricParts(null, countUnit("title"))).toEqual({ unit: "", value: "—" });
	});
});

describe("formatAxisValue", () => {
	it("abbreviates large numbers without count nouns and scales durations", () => {
		expect(formatAxisValue(12500, countUnit("set"))).toBe("12.5K");
		expect(formatAxisValue(5400, durationUnit("seconds"))).toBe("1.5h");
		expect(formatAxisValue(30, durationUnit("minutes"))).toBe("30m");
		expect(formatAxisValue(20, durationUnit("seconds"))).toBe("20s");
		expect(formatAxisValue(40, percentUnit)).toBe("40%");
	});
});

describe("axisTicks", () => {
	it("covers the data from zero with whole steps for counts", () => {
		expect(axisTicks(0, 1, countUnit("review"), 5)).toEqual([0, 1]);
		expect(axisTicks(0, 3, countUnit("review"), 4)).toEqual([0, 1, 2, 3]);
		expect(axisTicks(0, 347, countUnit("entry"), 4)).toEqual([0, 100, 200, 300, 400]);
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
