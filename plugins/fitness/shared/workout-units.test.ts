import { expect, it } from "vitest";

import {
	KILOGRAMS_PER_POUND,
	KILOMETERS_PER_MILE,
	kilogramsToPounds,
	kilometersToMiles,
	milesToKilometers,
	poundsToKilograms,
} from "./workout-units";

it("converts pounds and miles with the current factors in both directions", () => {
	expect(KILOGRAMS_PER_POUND).toBe(0.45359237);
	expect(KILOMETERS_PER_MILE).toBe(1.609344);
	expect(poundsToKilograms(1)).toBe(0.45359237);
	expect(kilogramsToPounds(0.45359237)).toBe(1);
	expect(milesToKilometers(1)).toBe(1.609344);
	expect(kilometersToMiles(1.609344)).toBe(1);
	expect(kilogramsToPounds(poundsToKilograms(12))).toBeCloseTo(12);
	expect(kilometersToMiles(milesToKilometers(12))).toBeCloseTo(12);
});
