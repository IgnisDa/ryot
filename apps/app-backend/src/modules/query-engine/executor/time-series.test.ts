import { DateTime } from "effect";
import { assert, describe, expect, it } from "vitest";

import { alignDateRangeToBucket } from "../time-series-buckets";

const parse = (value: string) => {
	const parsed = DateTime.make(value);
	assert(parsed._tag !== "None", `Invalid test date: ${value}`);
	return parsed.value;
};

describe("time-series bucket alignment", () => {
	it("aligns a partial day range to containing day buckets", () => {
		const range = alignDateRangeToBucket({
			bucket: "day",
			endAt: parse("2026-01-02T12:00:00.000Z"),
			startAt: parse("2026-01-01T10:00:00.000Z"),
		});

		expect(DateTime.formatIso(range.startAt)).toBe("2026-01-01T00:00:00.000Z");
		expect(DateTime.formatIso(range.endAt)).toBe("2026-01-03T00:00:00.000Z");
	});

	it("keeps an exclusive end boundary from creating an extra bucket", () => {
		const range = alignDateRangeToBucket({
			bucket: "day",
			endAt: parse("2026-01-03T00:00:00.000Z"),
			startAt: parse("2026-01-01T00:00:00.000Z"),
		});

		expect(DateTime.formatIso(range.startAt)).toBe("2026-01-01T00:00:00.000Z");
		expect(DateTime.formatIso(range.endAt)).toBe("2026-01-03T00:00:00.000Z");
	});

	it("aligns a week range to ISO Monday-start week buckets", () => {
		const range = alignDateRangeToBucket({
			bucket: "week",
			endAt: parse("2026-01-05T00:00:00.000Z"),
			startAt: parse("2026-01-01T10:00:00.000Z"),
		});

		expect(DateTime.formatIso(range.startAt)).toBe("2025-12-29T00:00:00.000Z");
		expect(DateTime.formatIso(range.endAt)).toBe("2026-01-05T00:00:00.000Z");
	});
});
