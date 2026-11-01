import { describe, expect, it } from "vitest";

import { localDay } from "./local-day";

describe("localDay", () => {
	it("formats the local calendar day of a timestamp with zero-padded parts", () => {
		expect(localDay(new Date(2026, 0, 5, 23, 59).getTime())).toBe("2026-01-05");
		expect(localDay(new Date(2026, 9, 15, 0, 0).getTime())).toBe("2026-10-15");
	});

	it("formats a Date the same as its timestamp", () => {
		const date = new Date(2026, 11, 31, 12, 30);

		expect(localDay(date)).toBe("2026-12-31");
		expect(localDay(date)).toBe(localDay(date.getTime()));
	});
});
