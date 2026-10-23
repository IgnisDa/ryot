import { describe, expect, it } from "@effect/vitest";

import { localDateTime, utcDateTime } from "./datetime";

describe("datetime form conversion", () => {
	it("converts a local wall time to UTC and preserves milliseconds", () => {
		expect(localDateTime("2026-10-19T10:30:45.123Z", "Asia/Kolkata")).toBe(
			"2026-10-19T16:00:45.123",
		);
		expect(utcDateTime("2026-10-19T16:00:45.123", "Asia/Kolkata")).toBe("2026-10-19T10:30:45.123Z");
	});

	it("uses the offset at the selected instant rather than today's offset", () => {
		expect(utcDateTime("2026-01-15T12:00", "America/New_York")).toBe("2026-01-15T17:00:00.000Z");
		expect(utcDateTime("2026-07-15T12:00", "America/New_York")).toBe("2026-07-15T16:00:00.000Z");
	});

	it("does not silently shift nonexistent local times across a DST gap", () => {
		expect(utcDateTime("2026-03-08T02:30", "America/New_York")).toBeUndefined();
	});
});
