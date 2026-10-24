import { describe, expect, it } from "vitest";

import { consumptionBasisFor, consumptionPropertiesEqual } from "./consumption";

describe("retained consumption evidence", () => {
	it("keeps type-specific units and never treats game time-to-beat as consumption", () => {
		expect(consumptionBasisFor("book", { pages: 123 })).toEqual({
			total: 123,
			unit: "pages",
			property: "pages",
		});
		expect(consumptionBasisFor("music", { duration: 215 })).toEqual({
			unit: "minutes",
			total: 215 / 60,
			property: "duration",
		});
		expect(consumptionBasisFor("visual-novel", { lengthMinutes: 900 })).toEqual({
			total: 900,
			unit: "minutes",
			property: "lengthMinutes",
		});
		expect(consumptionBasisFor("video-game", { runtime: 900, lengthMinutes: 900 })).toEqual({
			unit: "minutes",
		});
		expect(consumptionBasisFor("show", { runtime: 40 })).toEqual({ unit: "episodes" });
	});
	it("preserves unknown and zero separately and freezes primitive metadata", () => {
		const metadata = { runtime: 0 };
		const saved = consumptionBasisFor("movie", metadata);
		metadata.runtime = 180;
		expect(saved).toEqual({ total: 0, unit: "minutes", property: "runtime" });
		expect(consumptionBasisFor("movie", {})).toEqual({ unit: "minutes", property: "runtime" });
	});
	it("matches restored nested snapshots structurally without masking edits", () => {
		const expected = {
			calendarDate: "2026-02-01",
			consumptionBasis: { total: 100, unit: "pages" },
		};
		expect(consumptionPropertiesEqual(JSON.parse(JSON.stringify(expected)), expected)).toBe(true);
		expect(
			consumptionPropertiesEqual(
				{ ...expected, consumptionBasis: { total: 101, unit: "pages" } },
				expected,
			),
		).toBe(false);
		expect(consumptionPropertiesEqual({ ...expected, timeSpent: 10 }, expected)).toBe(false);
	});
});
