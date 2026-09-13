import { describe, expect, it } from "vitest";

import {
	activityDays,
	activityShares,
	activityStreak,
	activityWindow,
	largestRemainderPercents,
	localDateOf,
	resolveTimeZone,
} from "./activity-model";

describe("resolveTimeZone", () => {
	it.each([
		["Asia/Tokyo", "Asia/Tokyo"],
		[undefined, "UTC"],
		["", "UTC"],
		["Not/AZone", "UTC"],
		["+05:30", "UTC"],
	])("resolves %j to %s", (candidate, expected) => {
		expect(resolveTimeZone(candidate)).toBe(expected);
	});
});

describe("activityWindow", () => {
	it("starts on the Monday 51 weeks before this week and spans local midnights", () => {
		// 2026-09-25 is a Friday.
		expect(activityWindow("2026-09-25", "Asia/Kolkata")).toEqual({
			end: "2026-09-25",
			start: "2025-09-29",
			from: "2025-09-28T18:30:00.000Z",
			until: "2026-09-25T18:30:00.000Z",
		});
	});

	it("keeps a Monday today as the first day of the newest week", () => {
		const window = activityWindow("2026-09-21", "UTC");
		expect(window.start).toBe("2025-09-29");
		expect(window.until).toBe("2026-09-22T00:00:00.000Z");
	});

	it("follows daylight saving shifts for the bounds", () => {
		const window = activityWindow("2026-03-08", "America/New_York");
		expect(window.from).toBe("2025-03-10T04:00:00.000Z");
		expect(window.until).toBe("2026-03-09T04:00:00.000Z");
	});
});

describe("activityDays", () => {
	it("pads every date of the window and reads bucket instants as local dates", () => {
		const window = activityWindow("2026-09-25", "Asia/Kolkata");
		const days = activityDays(
			window,
			new Map([[localDateOf("2026-09-24T18:30:00.000Z", "Asia/Kolkata"), 3]]),
		);
		expect(days).toHaveLength(52 * 7 - 2);
		expect(days[0]).toEqual({ value: 0, date: "2025-09-29" });
		expect(days.at(-1)).toEqual({ value: 3, date: "2026-09-25" });
	});
});

describe("activityStreak", () => {
	it("counts back from today when today is active", () => {
		expect(activityStreak(new Set(["2026-09-23", "2026-09-24", "2026-09-25"]), "2026-09-25")).toBe(
			3,
		);
	});

	it("counts back from yesterday while today has no activity", () => {
		expect(activityStreak(new Set(["2026-09-23", "2026-09-24"]), "2026-09-25")).toBe(2);
	});

	it("is zero after a missed day", () => {
		expect(activityStreak(new Set(["2026-09-22", "2026-09-23"]), "2026-09-25")).toBe(0);
	});
});

describe("largestRemainderPercents", () => {
	it("hands leftover points to the largest remainders so the total is 100", () => {
		expect(largestRemainderPercents([1, 1, 1])).toEqual([34, 33, 33]);
		expect(largestRemainderPercents([625, 250, 125])).toEqual([63, 25, 12]);
	});

	it("is all zero without activity", () => {
		expect(largestRemainderPercents([0, 0])).toEqual([0, 0]);
	});
});

describe("activityShares", () => {
	it("drops inactive types and marks shares under one percent", () => {
		expect(
			activityShares([
				{ events: 995, slug: "show", label: "Show" },
				{ events: 5, slug: "book", label: "Book" },
				{ events: 0, slug: "music", label: "Music" },
			]),
		).toEqual([
			{ value: 995, key: "show", label: "Show", share: "100%" },
			{ value: 5, key: "book", share: "<1%", label: "Book" },
		]);
	});
});
