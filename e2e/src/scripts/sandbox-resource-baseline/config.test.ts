import { tmpdir } from "node:os";

import { describe, expect, it } from "~/support/effect-test";

import { DriverConfigError, readDriverConfig } from "./config";

const baseEnvironment = {
	SERVER_IP: "192.0.2.10",
	BENCHMARK_RUN_ID: "run-1",
	BENCHMARK_OUTPUT_DIR: "/tmp/baseline",
	BENCHMARK_ADMIN_ACCESS_TOKEN: "token",
	BENCHMARK_RAW_DIR: `${tmpdir()}/ryot-benchmark-raw`,
	BENCHMARK_API_URL: "https://ur-testing.ryot.io/api",
	BENCHMARK_FRONTEND_URL: "https://ur-testing.ryot.io",
};

describe("readDriverConfig", () => {
	it("refuses any target other than the dedicated benchmark host", () => {
		expect(() =>
			readDriverConfig({ ...baseEnvironment, BENCHMARK_API_URL: "https://ryot.io/api" }),
		).toThrow(DriverConfigError);
	});

	it("allows another target only behind the explicit local-development override", () => {
		const config = readDriverConfig({
			...baseEnvironment,
			BENCHMARK_ALLOW_NON_CANONICAL_HOST: "1",
			BENCHMARK_API_URL: "http://127.0.0.1:3000/api",
		});

		expect(config.apiUrl).toBe("http://127.0.0.1:3000/api");
	});

	it("keeps raw artifacts out of the repository", () => {
		expect(() =>
			readDriverConfig({ ...baseEnvironment, BENCHMARK_RAW_DIR: import.meta.dirname }),
		).toThrow("BENCHMARK_RAW_DIR must be outside the repository");
	});
});
