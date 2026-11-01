import { describe, expect, it } from "vitest";

import { TimeZone, UTC } from "../../schema/time-zone";
import {
	addCalendarUnits,
	calendarDaysBetween,
	localDateOf,
	startOfCalendarUnit,
	startOfLocalDay,
} from "./calendar";

const auckland = TimeZone.make("Pacific/Auckland");

describe("calendar", () => {
	it("reads instants in the zone and leaves date-only values unshifted", () => {
		const lateSunday = "2026-10-11T22:30:00.000Z";
		expect(localDateOf(lateSunday, UTC)).toBe("2026-10-11");
		expect(localDateOf(lateSunday, auckland)).toBe("2026-10-12");
		expect(localDateOf("2026-10-11", auckland)).toBe("2026-10-11");
	});

	it("starts weeks on Monday", () => {
		expect(startOfCalendarUnit("2026-10-11", "week")).toBe("2026-10-05");
		expect(startOfCalendarUnit("2026-10-12", "week")).toBe("2026-10-12");
	});

	it("steps calendar units and counts days between dates", () => {
		expect(addCalendarUnits("2026-12-01", "month", 1)).toBe("2027-01-01");
		expect(addCalendarUnits("2026-10-05", "week", -1)).toBe("2026-09-28");
		expect(calendarDaysBetween("2026-02-27", "2026-03-02")).toBe(3);
	});

	it("finds the instant a local day begins", () => {
		expect(startOfLocalDay("2026-03-08", TimeZone.make("America/New_York"))).toBe(
			"2026-03-08T05:00:00.000Z",
		);
	});
});
