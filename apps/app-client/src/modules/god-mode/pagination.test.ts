import { describe, expect, it } from "vitest";

import { GOD_MODE_PAGE_SIZE, godModePageOffsets, hasMoreGodModeUsers } from "./pagination";

describe("god-mode pagination", () => {
	it("derives one page offset per loaded page", () => {
		expect(godModePageOffsets(1)).toEqual([0]);
		expect(godModePageOffsets(3)).toEqual([0, GOD_MODE_PAGE_SIZE, GOD_MODE_PAGE_SIZE * 2]);
	});

	it("reports more users only while the loaded window is short of the total", () => {
		expect(hasMoreGodModeUsers({ total: 120, offset: 0, loaded: 50 })).toBe(true);
		expect(hasMoreGodModeUsers({ total: 120, offset: 100, loaded: 20 })).toBe(false);
		expect(hasMoreGodModeUsers({ total: 0, offset: 0, loaded: 0 })).toBe(false);
	});
});
