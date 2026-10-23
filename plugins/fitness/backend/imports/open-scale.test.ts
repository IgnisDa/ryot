import { describe, expect, it } from "vitest";

import { adaptOpenScaleCsv } from "./open-scale";

describe("adaptOpenScaleCsv", () => {
	it("normalizes statistics and skips date/comment columns", () => {
		const csv = [
			"dateTime,weight,bmi,comment",
			"2026-04-01 08:00:00,75.0,22.5,Morning",
			"2026-04-02 08:00:00,74.8,22.4,",
		].join("\n");

		const { items, failures } = adaptOpenScaleCsv(csv, "Asia/Kolkata");

		expect(failures).toHaveLength(0);
		expect(items).toHaveLength(2);
		expect(items[0]?.properties.comment).toBe("Morning");
		expect(items[1]?.properties.comment).toBeNull();
		expect(items[0]?.properties.statistics).toEqual([
			{ value: 75, key: "weight", label: "weight" },
			{ key: "bmi", value: 22.5, label: "bmi" },
		]);
		expect(items[0]?.properties.recordedAt).toBe("2026-04-01T02:30:00.000Z");
	});

	it("records a row-level failure for a missing date value", () => {
		const csv = ["dateTime,weight", ",75.0", "2026-04-02 08:00:00,74.8"].join("\n");

		const { items, failures } = adaptOpenScaleCsv(csv, "Asia/Kolkata");

		expect(items).toHaveLength(1);
		expect(failures).toHaveLength(1);
		expect(failures[0]?.message).toMatch(/missing a date\/time value/);
	});

	it("records a row-level failure for an unparseable numeric value", () => {
		const csv = ["dateTime,weight", "2026-04-01 08:00:00,not-a-number"].join("\n");

		const { items, failures } = adaptOpenScaleCsv(csv, "Asia/Kolkata");

		expect(items).toHaveLength(0);
		expect(failures).toHaveLength(1);
		expect(failures[0]?.message).toMatch(/Could not parse numeric value/);
	});

	it("records a row-level failure for a dated row with only empty statistic cells", () => {
		const csv = ["dateTime,weight,bmi,comment", "2026-04-01 08:00:00,,,Only a note"].join("\n");

		const { items, failures } = adaptOpenScaleCsv(csv, "Asia/Kolkata");

		expect(items).toHaveLength(0);
		expect(failures).toMatchObject([
			{ itemIndex: 0, message: "OpenScale row has no measurement values" },
		]);
	});

	it("supports separate date and time columns", () => {
		const csv = ["date,time,weight", "2026-04-01,08:00:00,80.5"].join("\n");

		const { items, failures } = adaptOpenScaleCsv(csv, "Asia/Kolkata");

		expect(failures).toHaveLength(0);
		expect(items).toHaveLength(1);
		expect(items[0]?.properties.statistics).toEqual([
			{ value: 80.5, key: "weight", label: "weight" },
		]);
		expect(items[0]?.properties.recordedAt).toBe("2026-04-01T02:30:00.000Z");
	});

	it("throws when no recognizable date column exists", () => {
		expect(() => adaptOpenScaleCsv("weight,bmi\n75.0,22.5", "Asia/Kolkata")).toThrow(
			/date\/time column/,
		);
	});

	it.each([
		["2026-01-15 08:00:00", "America/New_York", "2026-01-15T13:00:00.000Z"],
		["2026-07-15 08:00:00", "America/New_York", "2026-07-15T12:00:00.000Z"],
		["2026-11-01 01:30:00", "America/New_York", "2026-11-01T05:30:00.000Z"],
		["2026-04-01T08:00:00Z", "Asia/Kolkata", "2026-04-01T08:00:00.000Z"],
		["2026-04-01T08:00:00.123Z", "Asia/Kolkata", "2026-04-01T08:00:00.123Z"],
		["2026-04-01T08:00:00+05:30", "America/New_York", "2026-04-01T02:30:00.000Z"],
		["2026-04-01T08:00:00+0530", "America/New_York", "2026-04-01T02:30:00.000Z"],
		["2026-11-01T01:30:00-05:00", "America/New_York", "2026-11-01T06:30:00.000Z"],
		["2026-03-08T02:30:00-05:00", "America/New_York", "2026-03-08T07:30:00.000Z"],
	])("resolves %s in %s without changing explicit instants", (timestamp, timezone, expected) => {
		const { items, failures } = adaptOpenScaleCsv(`dateTime,weight\n${timestamp},75`, timezone);

		expect(failures).toEqual([]);
		expect(items).toHaveLength(1);
		expect(items[0]?.properties.recordedAt).toBe(expected);
		expect(items[0]?.sourceIdentifier).toBe(expected);
	});

	it.each([
		["Asia/Kolkata", "2026-03-07T18:30:00.000Z"],
		["America/New_York", "2026-03-08T05:00:00.000Z"],
	])("uses local midnight for date-only rows in %s", (timezone, expected) => {
		const { items, failures } = adaptOpenScaleCsv("date,weight\n2026-03-08,75", timezone);

		expect(failures).toEqual([]);
		expect(items[0]?.properties.recordedAt).toBe(expected);
	});

	it("rejects a DST gap supplied in separate date and time columns", () => {
		const { items, failures } = adaptOpenScaleCsv(
			"date,time,weight\n2026-03-08,02:30:00,75",
			"America/New_York",
		);

		expect(items).toEqual([]);
		expect(failures).toMatchObject([{ itemIndex: 0, message: "Could not parse date/time value" }]);
	});

	it.each([
		"not-a-date",
		"2026-02-30 08:00:00",
		"2026-02-30T08:00:00Z",
		"2026-04-01 25:00:00",
		"2026-03-08 02:30:00",
	])("rejects invalid or nonexistent local timestamp %s without losing later rows", (timestamp) => {
		const { items, failures } = adaptOpenScaleCsv(
			`dateTime,weight\n${timestamp},75\n2026-03-08 03:30:00,74`,
			"America/New_York",
		);

		expect(failures).toEqual([
			{
				itemIndex: 0,
				sourceLabel: "Row 1",
				sourceIdentifier: "1",
				message: "Could not parse date/time value",
			},
		]);
		expect(items).toHaveLength(1);
		expect(items[0]?.properties.recordedAt).toBe("2026-03-08T07:30:00.000Z");
	});
});
