import { describe, expect, it } from "vitest";

import {
	compactTitleProgress,
	HEADER_LARGE_TITLE_HEIGHT,
	HEADER_ROW_HEIGHT,
	headerSurfaceProgress,
} from "./header-metrics";

describe("compactTitleProgress", () => {
	it("keeps the compact title hidden while the large title is in view", () => {
		expect(compactTitleProgress(0)).toBe(0);
		expect(compactTitleProgress(-40)).toBe(0);
	});

	it("reaches full opacity once the large title has scrolled away", () => {
		expect(compactTitleProgress(HEADER_LARGE_TITLE_HEIGHT)).toBe(1);
		expect(compactTitleProgress(HEADER_LARGE_TITLE_HEIGHT * 4)).toBe(1);
	});

	it("crossfades between the two states", () => {
		const progress = compactTitleProgress(HEADER_LARGE_TITLE_HEIGHT * 0.725);

		expect(progress).toBeGreaterThan(0);
		expect(progress).toBeLessThan(1);
	});

	it("defers the crossfade past a hero section", () => {
		expect(compactTitleProgress(HEADER_LARGE_TITLE_HEIGHT, 300)).toBe(0);
		expect(compactTitleProgress(300 + HEADER_LARGE_TITLE_HEIGHT - HEADER_ROW_HEIGHT, 300)).toBe(1);
	});
});

describe("headerSurfaceProgress", () => {
	it("stays transparent at rest", () => {
		expect(headerSurfaceProgress(0)).toBe(0);
		expect(headerSurfaceProgress(0, 300)).toBe(0);
	});

	it("becomes opaque shortly after scrolling starts", () => {
		expect(headerSurfaceProgress(28)).toBe(1);
	});

	it("stays transparent over a hero until it reaches the compact row", () => {
		expect(headerSurfaceProgress(120, 300)).toBe(0);
		expect(headerSurfaceProgress(300 - HEADER_ROW_HEIGHT, 300)).toBe(1);
	});
});
