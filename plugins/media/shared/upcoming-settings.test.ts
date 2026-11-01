import { describe, expect, it } from "vitest";

import { upcomingSettings } from "./upcoming-settings";

describe("upcoming settings", () => {
	it.each([
		[undefined, { daysAhead: 14, onePerTitle: true }],
		[
			{ upcomingDaysAhead: 30, upcomingOnePerTitle: false },
			{ daysAhead: 30, onePerTitle: false },
		],
		[
			{ upcomingDaysAhead: 0, upcomingOnePerTitle: "no" },
			{ daysAhead: 14, onePerTitle: true },
		],
		[{ upcomingDaysAhead: 2.5 }, { daysAhead: 14, onePerTitle: true }],
		[{ upcomingDaysAhead: 900 }, { daysAhead: 365, onePerTitle: true }],
	])("reads %j as %j", (settings, expected) => {
		expect(upcomingSettings(settings)).toEqual(expected);
	});
});
