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

const loadSystemConfig = (logLevel?: string) =>
	Effect.runSyncExit(
		AppConfig.pipe(
			Effect.provide(
				AppConfig.layer.pipe(
					Layer.provide(
						makeConfigProviderLayer({
							REDIS_URL: "unused",
							DATABASE_URL: "unused",
							SERVER_ADMIN_ACCESS_TOKEN: "unused",
							...(logLevel === undefined ? {} : { SERVER_LOG_LEVEL: logLevel }),
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

	it("parses values case-insensitively", () => {
		const result = loadSystemConfig("DeBuG");
		assert(Exit.isSuccess(result));
		expect(result.value.server.logLevel).toBe("Debug");
	});

	it("fails with a config error for unsupported values", () => {
		const result = loadSystemConfig("verbose");
		assert(Exit.isFailure(result));
		expect(JSON.stringify(result.cause)).toContain("Unsupported SERVER_LOG_LEVEL 'verbose'");
	});
});

describe("validateSystemConfig workflow-pool capacity", () => {
	it("passes with default workflow pool capacity", () => {
		expect(Exit.isSuccess(validate())).toBe(true);
	});

	it("fails when workflow pool cannot support fixed sandbox worker capacity", () => {
		const result = validate({ database: { workflowPoolMax: 5 } });
		expect(Exit.isFailure(result)).toBe(true);
		if (Exit.isFailure(result)) {
			const message = JSON.stringify(result.cause);
			expect(message).toContain("SANDBOX_LIMITS.workerConcurrency");
			expect(message).toContain("DATABASE_WORKFLOW_POOL_MAX");
		}
	});

	it("passes when workflow pool matches fixed sandbox worker capacity", () => {
		const result = validate({ database: { workflowPoolMax: 6 } });
		expect(Exit.isSuccess(result)).toBe(true);
	});
});
