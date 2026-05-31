import { describe, expect, it } from "vitest";

import { adaptOpenScaleCsv } from "./adapter";

describe("adaptOpenScaleCsv", () => {
	it("normalizes statistics and skips date/comment columns", () => {
		const csv = [
			"dateTime,weight,bmi,comment",
			"2026-04-01 08:00:00,75.0,22.5,Morning",
			"2026-04-02 08:00:00,74.8,22.4,",
		].join("\n");

		const { items, failures } = adaptOpenScaleCsv(csv);

		expect(failures).toHaveLength(0);
		expect(items).toHaveLength(2);
		expect(items[0]?.properties.comment).toBe("Morning");
		expect(items[1]?.properties.comment).toBeNull();
		expect(items[0]?.properties.statistics).toEqual([
			{ key: "weight", label: "weight", value: 75 },
			{ key: "bmi", label: "bmi", value: 22.5 },
		]);
		expect(new Date(items[0]?.properties.recordedAt ?? "").getTime()).not.toBeNaN();
	});

	it("records a row-level failure for a missing date value", () => {
		const csv = ["dateTime,weight", ",75.0", "2026-04-02 08:00:00,74.8"].join("\n");

		const { items, failures } = adaptOpenScaleCsv(csv);

		expect(items).toHaveLength(1);
		expect(failures).toHaveLength(1);
		expect(failures[0]?.message).toMatch(/missing a date\/time value/);
	});

	it("records a row-level failure for an unparseable numeric value", () => {
		const csv = ["dateTime,weight", "2026-04-01 08:00:00,not-a-number"].join("\n");

		const { items, failures } = adaptOpenScaleCsv(csv);

		expect(items).toHaveLength(0);
		expect(failures).toHaveLength(1);
		expect(failures[0]?.message).toMatch(/Could not parse numeric value/);
	});

	it("supports separate date and time columns", () => {
		const csv = ["date,time,weight", "2026-04-01,08:00:00,80.5"].join("\n");

		const { items, failures } = adaptOpenScaleCsv(csv);

		expect(failures).toHaveLength(0);
		expect(items).toHaveLength(1);
		expect(items[0]?.properties.statistics).toEqual([
			{ key: "weight", label: "weight", value: 80.5 },
		]);
	});

	it("throws when no recognizable date column exists", () => {
		expect(() => adaptOpenScaleCsv("weight,bmi\n75.0,22.5")).toThrow(/date\/time column/);
	});
});
