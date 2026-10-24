import { describe, expect, it } from "vitest";

import { fitnessMetricDefinitions } from "../../shared/fitness-metrics";
import { formatMeasure, formatSignedMeasure } from "./format";

describe("weighted volume display", () => {
	it("keeps recorded zero in metric and imperial volume units", () => {
		expect(formatMeasure(0, fitnessMetricDefinitions.volume.unit)).toBe("0 kg × reps");
		expect(formatMeasure(0, fitnessMetricDefinitions.volume.unit, true)).toBe("0 lb × reps");
	});

	it("does not round away fractional weighted volume", () => {
		expect(formatMeasure(100.000001, fitnessMetricDefinitions.volume.unit)).toBe(
			"100.000001 kg × reps",
		);
		expect(formatMeasure(100.000001, fitnessMetricDefinitions.volume.unit, true)).toBe(
			"220.46226438950018 lb × reps",
		);
		expect(formatSignedMeasure(0.000001, fitnessMetricDefinitions.volume.unit)).toBe(
			"+0.000001 kg × reps",
		);
	});
});
