import { assert, describe, expect, it, layer } from "@effect/vitest";
import { Cause, Effect, Exit, Option, Redacted, Result } from "effect";

import type { AppConfigValue } from "#lib/infrastructure/config/service";
import {
	AppConfig,
	parseOtlpHeaders,
	validateSystemConfig,
} from "#lib/infrastructure/config/service";
import { makeAppConfigLayer, makeConfigProviderLayer } from "#lib/test-utils/effect";

const validated = Effect.exit(
	Effect.gen(function* () {
		const config: AppConfigValue = yield* AppConfig;
		return yield* validateSystemConfig(config);
	}),
);

const loaded = Effect.exit(AppConfig.make);

const systemEnvironmentLayer = (
	options: {
		readonly logFile?: string;
		readonly logLevel?: string;
		readonly logRotationSize?: string;
		readonly logRotationInterval?: string;
	} = {},
) =>
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
	});

const otlpEndpointLayer = (endpoint: string) =>
	makeAppConfigLayer({ observability: { otlp: { endpoint: Option.some(endpoint) } } });

describe("system log config", () => {
	layer(systemEnvironmentLayer())((test) => {
		test.effect("loads the logging defaults", () =>
			Effect.gen(function* () {
				const result = yield* loaded;
				assert(Exit.isSuccess(result));
				expect(result.value.observability.logging.level).toBe("Info");
				expect(result.value.observability.logging.file.path).toBe("./logs/ryot.log");
				expect(result.value.observability.logging.file.rotationSize).toBe("10M");
				expect(result.value.observability.logging.file.rotationInterval).toBe("1d");
			}),
		);
	});

	layer(systemEnvironmentLayer())((test) => {
		test.effect("retains the infrequent scheduler phrase default", () =>
			Effect.gen(function* () {
				const result = yield* loaded;
				assert(Exit.isSuccess(result));
				expect(result.value.scheduler.infrequentCronJobsSchedule).toBe("0 0 * * *");
			}),
		);
	});

	layer(systemEnvironmentLayer())((test) => {
		test.effect("defaults sandbox worker concurrency to the two-vCPU baseline", () =>
			Effect.gen(function* () {
				const result = yield* loaded;
				assert(Exit.isSuccess(result));
				expect(result.value.sandbox.workerConcurrency).toBe(2);
			}),
		);
	});

	layer(systemEnvironmentLayer())((test) => {
		test.effect("defaults filesystem paths relative to the working directory", () =>
			Effect.gen(function* () {
				const result = yield* loaded;
				assert(Exit.isSuccess(result));
				expect(result.value.server.clientDir).toBe("./client");
				expect(result.value.server.pluginsSystemDir).toBe("./plugins");
				expect(result.value.fileStorage.localDir).toBe("./storage");
				expect(result.value.fileStorage.localTempDir).toBe("./work");
			}),
		);
	});

	layer(systemEnvironmentLayer({ logLevel: "DeBuG" }))((test) => {
		test.effect("parses values case-insensitively", () =>
			Effect.gen(function* () {
				const result = yield* loaded;
				assert(Exit.isSuccess(result));
				expect(result.value.observability.logging.level).toBe("Debug");
			}),
		);
	});

	layer(systemEnvironmentLayer({ logLevel: "verbose" }))((test) => {
		test.effect("fails with a config error for unsupported values", () =>
			Effect.gen(function* () {
				const result = yield* loaded;
				assert(Exit.isFailure(result));
				expect(Cause.pretty(result.cause)).toContain("Unsupported SERVER_LOG_LEVEL 'verbose'");
			}),
		);
	});

	for (const [options, message] of [
		[{ logFile: " " }, "SERVER_LOG_FILE"],
		[{ logRotationSize: "10" }, "SERVER_LOG_ROTATION_SIZE"],
		[{ logRotationInterval: "7m" }, "SERVER_LOG_ROTATION_INTERVAL"],
	] as const) {
		layer(systemEnvironmentLayer(options))((test) => {
			test.effect("rejects invalid file logging configuration", () =>
				Effect.gen(function* () {
					const result = yield* loaded;
					assert(Exit.isFailure(result));
					expect(Cause.pretty(result.cause)).toContain(message);
				}),
			);
		});
	}
});

describe("validateSystemConfig sandbox capacity", () => {
	layer(makeAppConfigLayer())((test) => {
		test.effect("passes with default sandbox capacity", () =>
			Effect.gen(function* () {
				expect(Exit.isSuccess(yield* validated)).toBe(true);
			}),
		);
	});

	for (const [poolMax, workerConcurrency, isValid] of [
		[7, 2, true],
		[6, 2, false],
		[10, 5, true],
		[9, 5, false],
	] as const) {
		layer(makeAppConfigLayer({ database: { poolMax }, sandbox: { workerConcurrency } }))((test) => {
			test.effect(
				`${isValid ? "accepts" : "rejects"} pool ${poolMax} with ${workerConcurrency} sandbox workers`,
				() =>
					Effect.gen(function* () {
						const result = yield* validated;
						expect(Exit.isSuccess(result)).toBe(isValid);
						if (!isValid) {
							assert(Exit.isFailure(result));
							const failure = Cause.findErrorOption(result.cause);
							assert(Option.isSome(failure));
							expect(failure.value).toMatchObject({ _tag: "ConfigError" });
							const message = Cause.pretty(result.cause);
							expect(message).toContain("DATABASE_POOL_MAX");
							expect(message).toContain("SANDBOX_WORKER_CONCURRENCY");
							expect(message).toContain("one cluster runner connection");
							expect(message).toContain("two durable queue worker connections");
							expect(message).toContain("one application connection");
							expect(message).toContain("sandbox host database dispatch connection");
						}
					}),
			);
		});
	}

	for (const value of [0, -1, 1.5, Number.NaN]) {
		for (const [key, sandbox] of [
			["SANDBOX_WORKER_CONCURRENCY", { workerConcurrency: value }],
			["SANDBOX_IMPORT_CONCURRENCY", { importConcurrency: value }],
			["SANDBOX_MEMORY_BUDGET_MIB", { memoryBudgetMiB: Option.some(value) }],
		] as const) {
			layer(makeAppConfigLayer({ sandbox }))((test) => {
				test.effect(`rejects ${key} ${value}`, () =>
					Effect.gen(function* () {
						const result = yield* validated;
						assert(Exit.isFailure(result));
						const failure = Cause.findErrorOption(result.cause);
						assert(Option.isSome(failure));
						expect(failure.value).toMatchObject({ _tag: "ConfigError" });
						expect(Cause.pretty(result.cause)).toContain(
							`${key} (${value}) must be a positive integer`,
						);
					}),
				);
			});
		}
	}
});

describe("FRONTEND_URL validation", () => {
	layer(makeAppConfigLayer({ frontendUrl: "https://ryot.example/" }))((test) => {
		test.effect("normalizes an absolute HTTP origin", () =>
			Effect.gen(function* () {
				const result = yield* validated;
				assert(Exit.isSuccess(result));
				expect(result.value.frontendUrl).toBe("https://ryot.example");
			}),
		);
	});

	for (const frontendUrl of [
		"http://ryot.local:8000",
		"http://192.168.1.50:8000",
		"http://localhost:3005",
	]) {
		layer(makeAppConfigLayer({ frontendUrl }))((test) => {
			test.effect(`accepts plain-HTTP origin ${frontendUrl} for self-hosters without TLS`, () =>
				Effect.gen(function* () {
					const result = yield* validated;
					assert(Exit.isSuccess(result));
					expect(result.value.frontendUrl).toBe(frontendUrl);
				}),
			);
		});
	}

	for (const frontendUrl of [
		"ryot.example",
		"ftp://ryot.example",
		"https://ryot.example/path",
		"https://user@ryot.example",
		"https://ryot.example?",
		"https://ryot.example?query=yes",
		"https://ryot.example#fragment",
	]) {
		layer(makeAppConfigLayer({ frontendUrl }))((test) => {
			test.effect(`rejects non-origin value ${frontendUrl}`, () =>
				Effect.gen(function* () {
					const result = yield* validated;
					expect(Exit.isFailure(result)).toBe(true);
					if (Exit.isFailure(result)) {
						expect(Cause.pretty(result.cause)).toContain(
							"FRONTEND_URL must be an absolute HTTP or HTTPS origin",
						);
					}
				}),
			);
		});
	}
});

describe("OTEL_EXPORTER_OTLP_ENDPOINT validation", () => {
	for (const endpoint of [
		"http://127.0.0.1:4318",
		"https://collector.example",
		"https://collector.example/otlp",
	]) {
		layer(otlpEndpointLayer(endpoint))((test) => {
			test.effect(`accepts collector base URL ${endpoint}`, () =>
				Effect.gen(function* () {
					const result = yield* validated;
					expect(Exit.isSuccess(result)).toBe(true);
				}),
			);
		});
	}

	for (const endpoint of ["collector.example", "ftp://collector.example", "127.0.0.1:4318"]) {
		layer(otlpEndpointLayer(endpoint))((test) => {
			test.effect(`rejects non-HTTP endpoint ${endpoint}`, () =>
				Effect.gen(function* () {
					const result = yield* validated;
					assert(Exit.isFailure(result));
					expect(Cause.pretty(result.cause)).toContain(
						"OTEL_EXPORTER_OTLP_ENDPOINT must be an absolute HTTP or HTTPS URL",
					);
				}),
			);
		});
	}

	for (const endpoint of [
		"https://collector.example?token=abc",
		"https://collector.example#fragment",
		"https://user:secret@collector.example",
	]) {
		layer(otlpEndpointLayer(endpoint))((test) => {
			test.effect(`rejects endpoint ${endpoint} carrying a query, fragment, or credentials`, () =>
				Effect.gen(function* () {
					const result = yield* validated;
					assert(Exit.isFailure(result));
					expect(Cause.pretty(result.cause)).toContain(
						"OTEL_EXPORTER_OTLP_ENDPOINT must not contain a query, fragment, or credentials",
					);
				}),
			);
		});
	}

	for (const endpoint of [
		"https://collector.example/v1/logs",
		"https://api.honeycomb.io/v1/traces",
		"https://collector.example/otlp/v1/traces/",
		"https://collector.example/v1/metrics",
	]) {
		layer(otlpEndpointLayer(endpoint))((test) => {
			test.effect(
				`rejects endpoint ${endpoint} that already carries the appended signal path`,
				() =>
					Effect.gen(function* () {
						const result = yield* validated;
						assert(Exit.isFailure(result));
						expect(Cause.pretty(result.cause)).toContain("without an OTLP signal path");
					}),
			);
		});
	}
});

const egressAllowedNetworksLayer = (value: string) =>
	makeAppConfigLayer({ server: { egressAllowedNetworks: Option.some(value) } });

describe("SERVER_EGRESS_ALLOWED_NETWORKS validation", () => {
	layer(
		makeConfigProviderLayer({
			REDIS_URL: "unused",
			DATABASE_URL: "unused",
			SERVER_ADMIN_ACCESS_TOKEN: "unused",
			SERVER_EGRESS_ALLOWED_NETWORKS: " 127.0.0.1/32, ::1/128 ,10.0.0.0/8,fd00::/8,0.0.0.0/0",
		}),
	)((test) => {
		test.effect("loads a comma-separated list of CIDR networks", () =>
			Effect.gen(function* () {
				const result = yield* loaded;
				assert(Exit.isSuccess(result));
				expect(result.value.server.egressAllowedNetworks).toEqual(
					Option.some(" 127.0.0.1/32, ::1/128 ,10.0.0.0/8,fd00::/8,0.0.0.0/0"),
				);
			}),
		);
	});

	for (const [value, message] of [
		["localhost", "'localhost' is not a CIDR network"],
		["10.0.0.1", "'10.0.0.1' is not a CIDR network"],
		["10.0.0.1/8", "'10.0.0.1/8' is not a CIDR network"],
		[
			"127.0.0.1/32,169.254.169.254/32",
			"'169.254.169.254/32' is inside a range that cannot be allowed",
		],
		["fe80::/64", "'fe80::/64' is inside a range that cannot be allowed"],
		["::/128", "'::/128' is inside a range that cannot be allowed"],
	] as const) {
		layer(egressAllowedNetworksLayer(value))((test) => {
			test.effect(`rejects ${value}`, () =>
				Effect.gen(function* () {
					const result = yield* validated;
					assert(Exit.isFailure(result));
					expect(Cause.pretty(result.cause)).toContain(
						`SERVER_EGRESS_ALLOWED_NETWORKS is invalid: ${message}.`,
					);
				}),
			);
		});
	}
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

	layer(
		makeAppConfigLayer({
			observability: { otlp: { headers: Option.some(Redacted.make("s3cret-token")) } },
		}),
	)((test) => {
		test.effect("fails startup when the configured headers are malformed", () =>
			Effect.gen(function* () {
				const result = yield* validated;
				assert(Exit.isFailure(result));
				expect(Cause.pretty(result.cause)).toContain(
					"OTEL_EXPORTER_OTLP_HEADERS is invalid: entry 1 is not a key=value pair",
				);
			}),
		);
	});
});

describe("automation configuration", () => {
	layer(makeAppConfigLayer({ automations: { retryWindowDays: 8, historyRetentionDays: 7 } }))(
		(test) => {
			test.effect("rejects history retention shorter than the retry window", () =>
				Effect.gen(function* () {
					expect(Exit.isFailure(yield* validated)).toBe(true);
				}),
			);
		},
	);

	layer(makeAppConfigLayer())((test) => {
		test.effect("rejects unbounded or fractional recursion limits", () =>
			Effect.gen(function* () {
				const config = yield* AppConfig;
				for (const automations of [{ maxDepth: 1.5 }, { maxRuns: 10001 }]) {
					const result = yield* Effect.exit(
						validateSystemConfig({
							...config,
							automations: { ...config.automations, ...automations },
						}),
					);
					expect(Exit.isFailure(result)).toBe(true);
				}
			}),
		);
	});
});

const lanesEnvironmentLayer = (lanes: string | undefined, socketDir: string | undefined) =>
	makeConfigProviderLayer({
		REDIS_URL: "unused",
		DATABASE_URL: "unused",
		SERVER_ADMIN_ACCESS_TOKEN: "unused",
		...(lanes === undefined ? {} : { SERVER_LANES: lanes }),
		...(socketDir === undefined ? {} : { SERVER_RUNNER_SOCKET_DIR: socketDir }),
	});

describe("SERVER_LANES validation", () => {
	for (const [lanes, socketDir, expected] of [
		[undefined, undefined, "all"],
		["all", undefined, "all"],
		["interactive", "/run/ryot", "interactive"],
		["background", "/run/ryot", "background"],
	] as const) {
		layer(lanesEnvironmentLayer(lanes, socketDir))((test) => {
			test.effect(`loads SERVER_LANES=${lanes ?? "(unset)"}`, () =>
				Effect.gen(function* () {
					const result = yield* loaded;
					assert(Exit.isSuccess(result));
					expect(result.value.server.lanes).toBe(expected);
				}),
			);
		});
	}

	for (const [lanes, socketDir, message] of [
		["batch", undefined, "SERVER_LANES must be one of: all, interactive, background"],
		[
			"interactive",
			undefined,
			"SERVER_LANES=interactive requires SERVER_RUNNER_SOCKET_DIR to be an absolute path.",
		],
		[
			"background",
			"run/ryot",
			"SERVER_LANES=background requires SERVER_RUNNER_SOCKET_DIR to be an absolute path.",
		],
		[
			"all",
			"/run/ryot",
			"SERVER_RUNNER_SOCKET_DIR is only valid when SERVER_LANES is set to a role.",
		],
		[
			undefined,
			"/run/ryot",
			"SERVER_RUNNER_SOCKET_DIR is only valid when SERVER_LANES is set to a role.",
		],
	] as const) {
		layer(lanesEnvironmentLayer(lanes, socketDir))((test) => {
			test.effect(
				`rejects SERVER_LANES=${lanes ?? "(unset)"} with ${socketDir ?? "no"} socket directory`,
				() =>
					Effect.gen(function* () {
						const result = yield* loaded;
						assert(Exit.isFailure(result));
						expect(Cause.pretty(result.cause)).toContain(message);
					}),
			);
		});
	}
});
