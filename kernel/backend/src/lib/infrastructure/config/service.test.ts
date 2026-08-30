import { Effect, Exit, Layer } from "effect";
import { assert, describe, expect, it } from "vitest";

import type { AppConfigValue } from "#lib/infrastructure/config/service";
import { AppConfig, validateSystemConfig } from "#lib/infrastructure/config/service";
import { makeAppConfigLayer, makeConfigProviderLayer } from "#lib/test-utils/effect";

type Overrides = Parameters<typeof makeAppConfigLayer>[0];

const validate = (overrides?: Overrides) =>
	Effect.runSyncExit(
		Effect.gen(function* () {
			const config: AppConfigValue = yield* AppConfig;
			return yield* validateSystemConfig(config);
		}).pipe(Effect.provide(makeAppConfigLayer(overrides))),
	);

const loadSystemConfig = (
	options: { readonly logLevel?: string; readonly processMode?: string } = {},
) =>
	Effect.runSyncExit(
		AppConfig.pipe(
			Effect.provide(
				AppConfig.layer.pipe(
					Layer.provide(
						makeConfigProviderLayer({
							REDIS_URL: "unused",
							DATABASE_URL: "unused",
							SERVER_ADMIN_ACCESS_TOKEN: "unused",
							...(options.logLevel === undefined ? {} : { SERVER_LOG_LEVEL: options.logLevel }),
							...(options.processMode === undefined
								? {}
								: { SANDBOX_PROCESS_MODE: options.processMode }),
						}),
					),
				),
			),
		),
	);

describe("system log level config", () => {
	it("defaults to info", () => {
		const result = loadSystemConfig();
		assert(Exit.isSuccess(result));
		expect(result.value.server.logLevel).toBe("Info");
	});

	it("retains the infrequent scheduler phrase default", () => {
		const result = loadSystemConfig();
		assert(Exit.isSuccess(result));
		expect(result.value.scheduler.infrequentCronJobsSchedule).toBe("0 0 * * *");
	});

	it("defaults to on-demand sandbox processes", () => {
		const result = loadSystemConfig();
		assert(Exit.isSuccess(result));
		expect(result.value.sandbox.processMode).toBe("on-demand");
	});

	it("defaults filesystem paths relative to the working directory", () => {
		const result = loadSystemConfig();
		assert(Exit.isSuccess(result));
		expect(result.value.server.clientDir).toBe("./client");
		expect(result.value.server.pluginsSystemDir).toBe("./plugins");
		expect(result.value.fileStorage.localDir).toBe("./storage");
		expect(result.value.fileStorage.localTempDir).toBe("./work");
		expect(result.value.sandbox.denoDir).toBe("./tmp");
	});

	it("accepts warm sandbox processes", () => {
		const result = loadSystemConfig({ processMode: "warm" });
		assert(Exit.isSuccess(result));
		expect(result.value.sandbox.processMode).toBe("warm");
	});

	it("parses values case-insensitively", () => {
		const result = loadSystemConfig({ logLevel: "DeBuG" });
		assert(Exit.isSuccess(result));
		expect(result.value.server.logLevel).toBe("Debug");
	});

	it("fails with a config error for unsupported values", () => {
		const result = loadSystemConfig({ logLevel: "verbose" });
		assert(Exit.isFailure(result));
		expect(JSON.stringify(result.cause)).toContain("Unsupported SERVER_LOG_LEVEL 'verbose'");
	});
});

describe("validateSystemConfig shared application/workflow pool capacity", () => {
	it("passes with default shared application/workflow pool capacity", () => {
		expect(Exit.isSuccess(validate())).toBe(true);
	});

	it("fails when shared application/workflow pool cannot support fixed sandbox worker capacity", () => {
		const result = validate({ database: { poolMax: 5 } });
		expect(Exit.isFailure(result)).toBe(true);
		if (Exit.isFailure(result)) {
			const message = JSON.stringify(result.cause);
			expect(message).toContain("SANDBOX_LIMITS.workerConcurrency");
			expect(message).toContain("DATABASE_POOL_MAX");
		}
	});

	it("passes when shared application/workflow pool matches fixed sandbox worker capacity", () => {
		const result = validate({ database: { poolMax: 6 } });
		expect(Exit.isSuccess(result)).toBe(true);
	});
});

describe("FRONTEND_URL validation", () => {
	it("normalizes an absolute HTTP origin", () => {
		const result = validate({ frontendUrl: "https://ryot.example/" });
		assert(Exit.isSuccess(result));
		expect(result.value.frontendUrl).toBe("https://ryot.example");
	});

	it.each(["http://ryot.local:8000", "http://192.168.1.50:8000", "http://localhost:3005"])(
		"accepts plain-HTTP origin %s for self-hosters without TLS",
		(frontendUrl) => {
			const result = validate({ frontendUrl });
			assert(Exit.isSuccess(result));
			expect(result.value.frontendUrl).toBe(frontendUrl);
		},
	);

	it.each([
		"ryot.example",
		"ftp://ryot.example",
		"https://ryot.example/path",
		"https://user@ryot.example",
		"https://ryot.example?",
		"https://ryot.example?query=yes",
		"https://ryot.example#fragment",
	])("rejects non-origin value %s", (frontendUrl) => {
		const result = validate({ frontendUrl });
		expect(Exit.isFailure(result)).toBe(true);
		if (Exit.isFailure(result)) {
			expect(JSON.stringify(result.cause)).toContain(
				"FRONTEND_URL must be an absolute HTTP or HTTPS origin",
			);
		}
	});
});
