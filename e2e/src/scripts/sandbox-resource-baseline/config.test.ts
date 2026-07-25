import { describe, expect, it } from "~/support/effect-test";

import { DriverConfigError, readDriverConfig } from "./config";

const NOW = "2026-09-14T10:20:30.400Z";

const baseEnvironment = {
	BENCHMARK_OUTPUT_DIR: "/tmp/baseline",
	BENCHMARK_ADMIN_ACCESS_TOKEN: "token",
	BENCHMARK_API_URL: "https://ur-testing.ryot.io",
	BENCHMARK_FRONTEND_URL: "https://ur-testing.ryot.io",
};

describe("readDriverConfig", () => {
	it("refuses any target other than the dedicated benchmark host", () => {
		expect(() =>
			readDriverConfig({ ...baseEnvironment, BENCHMARK_API_URL: "https://ryot.io" }, NOW),
		).toThrow(DriverConfigError);
	});

	it("allows another target only behind the explicit local-development override", () => {
		const config = readDriverConfig(
			{
				...baseEnvironment,
				BENCHMARK_ALLOW_NON_CANONICAL_HOST: "1",
				BENCHMARK_API_URL: "http://127.0.0.1:3000",
			},
			NOW,
		);
		expect(config.apiUrl).toBe("http://127.0.0.1:3000");
		expect(config.allowNonCanonicalHost).toBe(true);
	});

	it("fails when a required credential or target is missing", () => {
		expect(() =>
			readDriverConfig({ ...baseEnvironment, BENCHMARK_ADMIN_ACCESS_TOKEN: "  " }, NOW),
		).toThrow(DriverConfigError);
	});

	it("derives a filesystem-safe run id from the UTC timestamp and applies plan defaults", () => {
		const config = readDriverConfig(baseEnvironment, NOW);
		expect(config.runId).toBe("2026-09-14T10-20-30-400Z");
		expect(config.sampleIntervalMs).toBe(200);
		expect(config.hostSampleIntervalMs).toBe(1_000);
		expect(config.recoveryWindowMs).toBe(300_000);
		expect(config.stabilization).toEqual({
			windowMs: 120_000,
			maxWaitMs: 600_000,
			maxDriftRatio: 0.05,
		});
	});

	it("parses a scenario filter and rejects a negative interval", () => {
		const config = readDriverConfig(
			{ ...baseEnvironment, BENCHMARK_SCENARIOS: "00-idle, 01-direct-no-host ," },
			NOW,
		);
		expect(config.scenarioIds).toEqual(["00-idle", "01-direct-no-host"]);
		expect(() =>
			readDriverConfig({ ...baseEnvironment, BENCHMARK_SAMPLE_INTERVAL_MS: "-1" }, NOW),
		).toThrow(DriverConfigError);
	});
});
