import { describe, expect, it } from "bun:test";

import { testFormatters } from "@ryot-app/kernel-messages/testing";

import { testFitnessText } from "../../tests/client/test-text";
import { formatEnteredUnitValue, formatMeasure, formatSignedMeasure } from "./format";

describe("weighted volume display", () => {
	it("keeps recorded zero in metric and imperial volume units", () => {
		expect(formatMeasure(testFormatters, testFitnessText, 0, "volume")).toBe("0 kg × reps");
		expect(formatMeasure(testFormatters, testFitnessText, 0, "volume", true)).toBe("0 lb × reps");
	});

	it("does not round away fractional weighted volume", () => {
		expect(formatMeasure(testFormatters, testFitnessText, 100.000001, "volume")).toBe(
			"100.000001 kg × reps",
		);
		expect(formatMeasure(testFormatters, testFitnessText, 100.000001, "volume", true)).toBe(
			"220.46226438950018 lb × reps",
		);
		expect(formatSignedMeasure(testFormatters, testFitnessText, 0.000001, "volume")).toBe(
			"+0.000001 kg × reps",
		);
	});
});

describe("entered unit display", () => {
	it("localizes the unit of a numeric entry and keeps the entry's own digits otherwise", () => {
		expect(formatEnteredUnitValue(testFormatters, "100.5", "kg")).toBe("100.5 kg");
		expect(formatEnteredUnitValue(testFormatters, "45", "sec")).toBe("45 sec");
		expect(formatEnteredUnitValue(testFormatters, "4x", "km")).toBe("4x km");
	});
});
