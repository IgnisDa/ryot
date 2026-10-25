import { describe, expect, it } from "vitest";

import { formatMeasure, formatSignedMeasure } from "./format";

describe("weighted volume display", () => {
	it("keeps recorded zero in metric and imperial volume units", () => {
		expect(formatMeasure(0, "volume")).toBe("0 kg × reps");
		expect(formatMeasure(0, "volume", true)).toBe("0 lb × reps");
	});

	it("does not round away fractional weighted volume", () => {
		expect(formatMeasure(100.000001, "volume")).toBe("100.000001 kg × reps");
		expect(formatMeasure(100.000001, "volume", true)).toBe("220.46226438950018 lb × reps");
		expect(formatSignedMeasure(0.000001, "volume")).toBe("+0.000001 kg × reps");
	});
});
