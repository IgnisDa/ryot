import { TimeZone } from "@ryot-app/contract/schema/time-zone";
import { describe, expect, it } from "vitest";

import { consistencySelection, periodCaption } from "./reporting";

describe("periodCaption", () => {
	it("shortens ranges that share a month or year and names all time", () => {
		expect(periodCaption({ endDate: "2026-10-31", startDate: "2026-10-02" })).toBe(
			"Oct 2 – 31, 2026",
		);
		expect(periodCaption({ endDate: "2026-10-01", startDate: "2026-09-02" })).toBe(
			"Sep 2 – Oct 1, 2026",
		);
		expect(periodCaption({ endDate: "2026-01-03", startDate: "2025-12-15" })).toBe(
			"Dec 15, 2025 – Jan 3, 2026",
		);
		expect(periodCaption({ endDate: "2026-10-02", startDate: "2026-10-02" })).toBe("Oct 2, 2026");
		expect(periodCaption(null)).toBe("All time");
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
