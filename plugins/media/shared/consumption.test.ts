import { describe, expect, it } from "vitest";

import { consumptionBasisFor } from "./consumption";

describe("retained consumption basis", () => {
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
		expect(consumptionBasisFor("podcast-episode", { runtime: 40 })).toEqual({
			total: 40,
			unit: "minutes",
			property: "runtime",
		});
	});
	it("preserves unknown and zero separately and freezes primitive metadata", () => {
		const metadata = { runtime: 0 };
		const saved = consumptionBasisFor("movie", metadata);
		metadata.runtime = 180;
		expect(saved).toEqual({ total: 0, unit: "minutes", property: "runtime" });
		expect(consumptionBasisFor("movie", {})).toEqual({ unit: "minutes", property: "runtime" });
	});
});
