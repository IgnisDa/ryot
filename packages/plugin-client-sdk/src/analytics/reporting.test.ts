import { TimeZone } from "@ryot-app/contract/schema/time-zone";
import { describe, expect, it } from "vitest";

import { comparisonDetail, consistencySelection } from "./reporting";

const resolved = {
	current: { endDate: "2026-09-07", startDate: "2026-09-01" },
	previous: { endDate: "2026-08-31", startDate: "2026-08-25" },
} as const;
const periods = "2026-09-01 – 2026-09-07 vs 2026-08-25 – 2026-08-31";

describe("comparisonDetail", () => {
	it("describes changes, new activity, unknown values, and missing comparisons", () => {
		const detail = (current: null | number, previous: null | number) =>
			comparisonDetail({ current, previous, resolved, unit: "sets" });
		expect(detail(5, -10)).toBe(`${periods} · +15 sets (150 %)`);
		expect(detail(0, 0)).toBe(`${periods} · 0 sets (0 %)`);
		expect(detail(5, 0)).toBe(`${periods} · New activity · +5 sets`);
		expect(detail(null, 1)).toBe(`${periods} · Change unavailable`);
		expect(
			comparisonDetail({
				current: 1,
				unit: "sets",
				previous: null,
				resolved: { ...resolved, previous: null },
			}),
		).toBe("2026-09-01 – 2026-09-07 · No comparison");
	});
});

describe("consistencySelection", () => {
	const timeZone = TimeZone.make("UTC");
	const now = Date.parse("2026-09-07T12:00:00.000Z");

	it("keeps a short period and clips all time to the bucket limit ending today", () => {
		expect(
			consistencySelection(
				{
					timeZone,
					selection: { grouping: "week", comparison: "none", range: { days: 7, kind: "rolling" } },
				},
				now,
			),
		).toEqual({
			clipped: false,
			selection: {
				grouping: "day",
				comparison: "none",
				range: { kind: "custom", endDate: "2026-09-07", startDate: "2026-09-01" },
			},
		});
		expect(
			consistencySelection(
				{
					timeZone,
					selection: { grouping: "auto", comparison: "none", range: { kind: "all-time" } },
				},
				now,
			),
		).toEqual({
			clipped: true,
			selection: {
				grouping: "day",
				comparison: "none",
				range: { kind: "custom", endDate: "2026-09-07", startDate: "2025-09-07" },
			},
		});
	});
});
