import { Effect, Exit, Layer, Option, Redacted, Result } from "effect";
import { assert, describe, expect, it } from "vitest";

import type { AppConfigValue } from "#lib/infrastructure/config/service";
import {
	AppConfig,
	parseOtlpHeaders,
	validateSystemConfig,
} from "#lib/infrastructure/config/service";
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
		readonly logFile?: string;
		readonly logLevel?: string;
		readonly processMode?: string;
		readonly logRotationSize?: string;
		readonly workerConcurrency?: string;
		readonly logRotationInterval?: string;
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
							...(options.logFile === undefined ? {} : { SERVER_LOG_FILE: options.logFile }),
							...(options.logLevel === undefined ? {} : { SERVER_LOG_LEVEL: options.logLevel }),
							...(options.logRotationSize === undefined
								? {}
								: { SERVER_LOG_ROTATION_SIZE: options.logRotationSize }),
							...(options.logRotationInterval === undefined
								? {}
								: { SERVER_LOG_ROTATION_INTERVAL: options.logRotationInterval }),
							...(options.processMode === undefined
								? {}
								: { SANDBOX_PROCESS_MODE: options.processMode }),
							...(options.workerConcurrency === undefined
								? {}
								: { SANDBOX_WORKER_CONCURRENCY: options.workerConcurrency }),
						}),
					),
				),
			),
		),
	);

describe("system log config", () => {
	it("loads the logging defaults", () => {
		const result = loadSystemConfig();
		assert(Exit.isSuccess(result));
		expect(result.value.observability.logging.level).toBe("Info");
		expect(result.value.observability.logging.file.path).toBe("./logs/ryot.log");
		expect(result.value.observability.logging.file.rotationSize).toBe("10M");
		expect(result.value.observability.logging.file.rotationInterval).toBe("1d");
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

	it("defaults sandbox worker concurrency to the two-vCPU baseline", () => {
		const result = loadSystemConfig();
		assert(Exit.isSuccess(result));
		expect(result.value.sandbox.workerConcurrency).toBe(2);
	});

	it("reads sandbox worker concurrency from the environment", () => {
		const result = loadSystemConfig({ workerConcurrency: "5" });
		assert(Exit.isSuccess(result));
		expect(result.value.sandbox.workerConcurrency).toBe(5);
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
		expect(result.value.observability.logging.level).toBe("Debug");
	});

	it("fails with a config error for unsupported values", () => {
		const result = loadSystemConfig({ logLevel: "verbose" });
		assert(Exit.isFailure(result));
		expect(JSON.stringify(result.cause)).toContain("Unsupported SERVER_LOG_LEVEL 'verbose'");
	});

	it.each([
		[{ logFile: " " }, "SERVER_LOG_FILE"],
		[{ logRotationSize: "10" }, "SERVER_LOG_ROTATION_SIZE"],
		[{ logRotationInterval: "7m" }, "SERVER_LOG_ROTATION_INTERVAL"],
	] as const)("rejects invalid file logging configuration", (options, message) => {
		const result = loadSystemConfig(options);
		assert(Exit.isFailure(result));
		expect(JSON.stringify(result.cause)).toContain(message);
	});
});

describe("validateSystemConfig shared application/workflow pool capacity", () => {
	it("passes with default shared application/workflow pool capacity", () => {
		expect(Exit.isSuccess(validate())).toBe(true);
	});

	it("fails when shared application/workflow pool cannot support the configured sandbox workers", () => {
		const result = validate({ database: { poolMax: 5 }, sandbox: { workerConcurrency: 5 } });
		expect(Exit.isFailure(result)).toBe(true);
		if (Exit.isFailure(result)) {
			const message = JSON.stringify(result.cause);
			expect(message).toContain("SANDBOX_WORKER_CONCURRENCY");
			expect(message).toContain("DATABASE_POOL_MAX");
		}
	});

	it("passes when shared application/workflow pool matches the configured sandbox workers", () => {
		const result = validate({ database: { poolMax: 6 }, sandbox: { workerConcurrency: 5 } });
		expect(Exit.isSuccess(result)).toBe(true);
	});

	it("keeps a lowered sandbox worker concurrency within a small pool", () => {
		const result = validate({ database: { poolMax: 5 }, sandbox: { workerConcurrency: 2 } });
		expect(Exit.isSuccess(result)).toBe(true);
	});

	it.each([0, -1, 1.5])("rejects sandbox worker concurrency %s", (workerConcurrency) => {
		const result = validate({ sandbox: { workerConcurrency } });
		expect(Exit.isFailure(result)).toBe(true);
		if (Exit.isFailure(result)) {
			expect(JSON.stringify(result.cause)).toContain("SANDBOX_WORKER_CONCURRENCY");
		}
	});

	it.each([0, -1, 1.5])("rejects import concurrency %s", (importConcurrency) => {
		const result = validate({ sandbox: { importConcurrency } });
		expect(Exit.isFailure(result)).toBe(true);
		if (Exit.isFailure(result)) {
			expect(JSON.stringify(result.cause)).toContain("SANDBOX_IMPORT_CONCURRENCY");
		}
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

describe("OTEL_EXPORTER_OTLP_ENDPOINT validation", () => {
	it.each(["http://127.0.0.1:4318", "https://collector.example", "https://collector.example/otlp"])(
		"accepts collector base URL %s",
		(endpoint) => {
			const result = validate({ observability: { otlp: { endpoint: Option.some(endpoint) } } });
			expect(Exit.isSuccess(result)).toBe(true);
		},
	);

	it.each(["collector.example", "ftp://collector.example", "127.0.0.1:4318"])(
		"rejects non-HTTP endpoint %s",
		(endpoint) => {
			const result = validate({ observability: { otlp: { endpoint: Option.some(endpoint) } } });
			assert(Exit.isFailure(result));
			expect(JSON.stringify(result.cause)).toContain(
				"OTEL_EXPORTER_OTLP_ENDPOINT must be an absolute HTTP or HTTPS URL",
			);
		},
	);

	it.each([
		"https://collector.example?token=abc",
		"https://collector.example#fragment",
		"https://user:secret@collector.example",
	])("rejects endpoint %s carrying a query, fragment, or credentials", (endpoint) => {
		const result = validate({ observability: { otlp: { endpoint: Option.some(endpoint) } } });
		assert(Exit.isFailure(result));
		expect(JSON.stringify(result.cause)).toContain(
			"OTEL_EXPORTER_OTLP_ENDPOINT must not contain a query, fragment, or credentials",
		);
	});

	it.each([
		"https://collector.example/v1/logs",
		"https://api.honeycomb.io/v1/traces",
		"https://collector.example/otlp/v1/traces/",
		"https://collector.example/v1/metrics",
	])("rejects endpoint %s that already carries the appended signal path", (endpoint) => {
		const result = validate({ observability: { otlp: { endpoint: Option.some(endpoint) } } });
		assert(Exit.isFailure(result));
		expect(JSON.stringify(result.cause)).toContain("without an OTLP signal path");
	});
});

describe("OTEL_EXPORTER_OTLP_HEADERS validation", () => {
	it("parses comma-separated pairs and keeps separators inside values", () => {
		const parsed = parseOtlpHeaders("x-honeycomb-team=abc123 , authorization=Basic dXNlcj1wdw==");
		assert(Result.isSuccess(parsed));
		expect(parsed.success).toEqual({
			"x-honeycomb-team": "abc123",
			authorization: "Basic dXNlcj1wdw==",
		});
	});

	it("ignores empty entries left by a trailing comma", () => {
		const parsed = parseOtlpHeaders("x-api-key=abc123,");
		assert(Result.isSuccess(parsed));
		expect(parsed.success).toEqual({ "x-api-key": "abc123" });
	});

	it("keeps the token out of the failure message for a pair with no separator", () => {
		const parsed = parseOtlpHeaders("s3cret-token");
		assert(Result.isFailure(parsed));
		expect(parsed.failure).toBe("entry 1 is not a key=value pair");
	});

	it.each(["x-api-key=", "x-api-key=   "])("rejects header %s with an empty value", (value) => {
		const parsed = parseOtlpHeaders(value);
		assert(Result.isFailure(parsed));
		expect(parsed.failure).toBe("header 'x-api-key' has an empty value");
	});

	it.each(["", "  ", ","])("rejects value %s that yields no headers", (value) => {
		const parsed = parseOtlpHeaders(value);
		assert(Result.isFailure(parsed));
		expect(parsed.failure).toBe("it is set but contains no headers");
	});

	it("fails startup when the configured headers are malformed", () => {
		const result = validate({
			observability: { otlp: { headers: Option.some(Redacted.make("s3cret-token")) } },
		});
		assert(Exit.isFailure(result));
		expect(JSON.stringify(result.cause)).toContain(
			"OTEL_EXPORTER_OTLP_HEADERS is invalid: entry 1 is not a key=value pair",
		);
	});
});

describe("automation configuration", () => {
	it("rejects history retention shorter than the retry window", () => {
		expect(
			Exit.isFailure(validate({ automations: { retryWindowDays: 8, historyRetentionDays: 7 } })),
		).toBe(true);
	});

	it("rejects unbounded or fractional recursion limits", () => {
		expect(Exit.isFailure(validate({ automations: { maxDepth: 1.5 } }))).toBe(true);
		expect(Exit.isFailure(validate({ automations: { maxRuns: 10001 } }))).toBe(true);
	});
});
