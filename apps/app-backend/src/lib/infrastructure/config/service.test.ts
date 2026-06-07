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
	options: {
		readonly logLevel?: string;
		readonly processMode?: string;
		readonly localSigningSecret?: string | null;
	} = {},
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
							...(options.localSigningSecret === null
								? {}
								: {
										FILE_STORAGE_LOCAL_SIGNING_SECRET:
											options.localSigningSecret ?? "test-local-signing-secret",
									}),
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

describe("local file storage config", () => {
	it("fails loading when the local signing secret is absent", () => {
		const result = loadSystemConfig({ localSigningSecret: null });
		assert(Exit.isFailure(result));
		expect(JSON.stringify(result.cause)).toContain(
			"FILE_STORAGE_LOCAL_SIGNING_SECRET is required and must not be empty.",
		);
	});

	it("fails validation when the local signing secret is empty", () => {
		const result = loadSystemConfig({ localSigningSecret: "" });
		assert(Exit.isFailure(result));
		expect(JSON.stringify(result.cause)).toContain(
			"FILE_STORAGE_LOCAL_SIGNING_SECRET is required and must not be empty.",
		);
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
