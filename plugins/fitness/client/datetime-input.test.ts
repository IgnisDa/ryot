import { describe, expect, it } from "vitest";

import { resolveDateTimeInput } from "./datetime-input";

describe("date-time input resolution", () => {
	it("preserves an unchanged second occurrence and its original seconds", () => {
		const original = "2026-11-01T06:30:37.456Z";

		expect(
			resolveDateTimeInput("2026-11-01T01:30", original, undefined, "America/New_York"),
		).toMatchObject({ iso: original, error: undefined });
	});

	it("keeps the selected New York occurrence when editing an ambiguous time", () => {
		expect(
			resolveDateTimeInput(
				"2026-11-01T01:45",
				"2026-11-01T06:30:00.000Z",
				undefined,
				"America/New_York",
			),
		).toMatchObject({ error: undefined, iso: "2026-11-01T06:45:00.000Z" });
		expect(
			resolveDateTimeInput(
				"2026-11-01T01:45",
				"2026-11-01T05:30:00.000Z",
				undefined,
				"America/New_York",
			),
		).toMatchObject({ error: undefined, iso: "2026-11-01T05:45:00.000Z" });
	});

	it("requires an occurrence for an ambiguous New York time without an original", () => {
		const result = resolveDateTimeInput("2026-11-01T01:30", null, undefined, "America/New_York");

		expect(result).toMatchObject({
			iso: null,
			choices: [{ value: "2026-11-01T05:30:00.000Z" }, { value: "2026-11-01T06:30:00.000Z" }],
		});
		expect(result.error).toContain("occurs twice");
		expect(
			resolveDateTimeInput(
				"2026-11-01T01:30",
				null,
				"2026-11-01T06:30:00.000Z",
				"America/New_York",
			),
		).toMatchObject({ error: undefined, iso: "2026-11-01T06:30:00.000Z" });
	});

	it("does not apply a stale occurrence to a different ambiguous local time", () => {
		expect(
			resolveDateTimeInput(
				"2026-11-01T01:45",
				null,
				"2026-11-01T06:30:00.000Z",
				"America/New_York",
			),
		).toMatchObject({ iso: null });
	});

	it("lets an explicit occurrence override the original offset", () => {
		expect(
			resolveDateTimeInput(
				"2026-11-01T01:30",
				"2026-11-01T06:30:37.456Z",
				"2026-11-01T05:30:00.000Z",
				"America/New_York",
			),
		).toMatchObject({ error: undefined, iso: "2026-11-01T05:30:00.000Z" });
	});

	it("requires a choice when the original is from the prior local date", () => {
		expect(
			resolveDateTimeInput(
				"2026-11-01T01:30",
				"2026-10-31T05:30:00.000Z",
				undefined,
				"America/New_York",
			),
		).toMatchObject({ iso: null });
	});

	it("rejects a New York spring-forward gap even with an explicit occurrence", () => {
		expect(
			resolveDateTimeInput(
				"2026-03-08T02:30",
				null,
				"2026-03-08T07:30:00.000Z",
				"America/New_York",
			),
		).toMatchObject({ iso: null, choices: [] });
	});

	it("preserves either Berlin fold occurrence", () => {
		expect(
			resolveDateTimeInput(
				"2026-10-25T02:30",
				"2026-10-25T00:15:00.000Z",
				undefined,
				"Europe/Berlin",
			),
		).toMatchObject({ error: undefined, iso: "2026-10-25T00:30:00.000Z" });
		expect(
			resolveDateTimeInput(
				"2026-10-25T02:30",
				"2026-10-25T01:15:00.000Z",
				undefined,
				"Europe/Berlin",
			),
		).toMatchObject({ error: undefined, iso: "2026-10-25T01:30:00.000Z" });
	});

	it("resolves Lord Howe's half-hour fold and accepts its later occurrence", () => {
		const result = resolveDateTimeInput("2026-04-05T01:45", null, undefined, "Australia/Lord_Howe");

		expect(result).toMatchObject({
			iso: null,
			choices: [{ value: "2026-04-04T14:45:00.000Z" }, { value: "2026-04-04T15:15:00.000Z" }],
		});
		expect(
			resolveDateTimeInput(
				"2026-04-05T01:45",
				null,
				"2026-04-04T15:15:00.000Z",
				"Australia/Lord_Howe",
			),
		).toMatchObject({ error: undefined, iso: "2026-04-04T15:15:00.000Z" });
	});

	for (const value of ["", "garbage", "2026-02-30T10:00"]) {
		it(`does not resolve invalid input ${JSON.stringify(value)}`, () => {
			expect(resolveDateTimeInput(value, null, undefined, "UTC")).toMatchObject({ iso: null });
		});
	}

	it("resolves an ordinary UTC time without an error", () => {
		const result = resolveDateTimeInput("2026-11-01T01:30", null, undefined, "UTC");

		expect(result).toMatchObject({ error: undefined, iso: "2026-11-01T01:30:00.000Z" });
		expect(result.choices).toHaveLength(1);
	});
});
