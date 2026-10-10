import { Duration } from "effect";
import { describe, expect, it } from "vitest";

import { parseFrequentSchedule } from "./cron";

const frequentIntervalMillis = (value: string | undefined) => {
	const parsed = parseFrequentSchedule(value);
	return parsed === null ? null : Duration.toMillis(parsed);
};

describe("parseFrequentSchedule", () => {
	it("parses 'every minute' as a one-minute interval", () => {
		expect(frequentIntervalMillis("every minute")).toBe(60_000);
	});

	it("parses 'every 5 minutes' as a five-minute interval", () => {
		expect(frequentIntervalMillis("every 5 minutes")).toBe(300_000);
	});

	it("parses 'every 2 hours' as a two-hour interval", () => {
		expect(frequentIntervalMillis("every 2 hours")).toBe(7_200_000);
	});

	it("returns null for an unsupported phrase", () => {
		expect(frequentIntervalMillis("every fortnight")).toBeNull();
	});

	it("returns null for a non-positive amount", () => {
		expect(frequentIntervalMillis("every 0 minutes")).toBeNull();
	});
});
