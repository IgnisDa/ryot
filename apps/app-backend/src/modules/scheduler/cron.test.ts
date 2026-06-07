import { Duration, Either } from "effect";
import { describe, expect, it } from "vitest";

import {
	DEFAULT_INFREQUENT_CRON,
	parseFrequentSchedule,
	parseInfrequentCron,
	phraseToCronExpression,
} from "./cron";

const frequentIntervalMillis = (value: string | undefined) => {
	const parsed = parseFrequentSchedule(value);
	return parsed === null ? null : Duration.toMillis(parsed);
};

describe("phraseToCronExpression", () => {
	it("maps 'every midnight' to the default infrequent cron expression", () => {
		expect(phraseToCronExpression("every midnight")).toBe(DEFAULT_INFREQUENT_CRON);
	});

	it("maps 'daily' to the default infrequent cron expression", () => {
		expect(phraseToCronExpression("daily")).toBe(DEFAULT_INFREQUENT_CRON);
	});

	it("passes a raw cron expression through unchanged", () => {
		expect(phraseToCronExpression("0 3 * * *")).toBe("0 3 * * *");
	});
});

describe("parseInfrequentCron", () => {
	it("returns Right for valid input", () => {
		const result = parseInfrequentCron("every midnight", "Etc/GMT");
		expect(Either.isRight(result)).toBe(true);
	});

	it("returns Left for garbage input", () => {
		const result = parseInfrequentCron("not a cron expression", "Etc/GMT");
		expect(Either.isLeft(result)).toBe(true);
	});
});

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
