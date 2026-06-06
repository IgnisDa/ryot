import { describe, expect, it } from "vitest";

import { dedupWindow } from "./youtube-music";

describe("dedupWindow", () => {
	it("returns a zone-local date and a positive sub-day TTL for a valid timezone", () => {
		const { localDate, ttlSeconds } = dedupWindow("America/New_York");

		expect(localDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		expect(ttlSeconds).toBeGreaterThan(0);
		expect(ttlSeconds).toBeLessThanOrEqual(86_400);
	});

	it("falls back to a full-day TTL for an unknown timezone", () => {
		const { localDate, ttlSeconds } = dedupWindow("Not/AZone");

		expect(localDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		expect(ttlSeconds).toBe(86_400);
	});
});
