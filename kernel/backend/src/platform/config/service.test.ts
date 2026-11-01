import { assert, describe, expect, layer } from "@effect/vitest";
import { Cause, Effect, Exit, Option, Redacted } from "effect";
import { IpNetwork } from "effect/net";

import { AppConfig } from "#platform/config/service";
import { makeRequiredConfigLayer } from "#testing/effect";

const loaded = Effect.exit(AppConfig.make);

const systemEnvironmentLayer = (
	options: {
		readonly logFile?: string;
		readonly logLevel?: string;
		readonly logRotationSize?: string;
		readonly logRotationInterval?: string;
	} = {},
) =>
	makeRequiredConfigLayer({
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
	makeRequiredConfigLayer({ OTEL_EXPORTER_OTLP_ENDPOINT: endpoint });

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
	layer(makeRequiredConfigLayer())((test) => {
		test.effect("passes with default sandbox capacity", () =>
			Effect.gen(function* () {
				expect(Exit.isSuccess(yield* loaded)).toBe(true);
			}),
		);
	});

	for (const [poolMax, workerConcurrency, isValid] of [
		[7, 2, true],
		[6, 2, false],
		[10, 5, true],
		[9, 5, false],
	] as const) {
		layer(
			makeRequiredConfigLayer({
				DATABASE_POOL_MAX: poolMax,
				SANDBOX_WORKER_CONCURRENCY: workerConcurrency,
			}),
		)((test) => {
			test.effect(
				`${isValid ? "accepts" : "rejects"} pool ${poolMax} with ${workerConcurrency} sandbox workers`,
				() =>
					Effect.gen(function* () {
						const result = yield* loaded;
						expect(Exit.isSuccess(result)).toBe(isValid);
						if (!isValid) {
							assert(Exit.isFailure(result));
							const failure = Cause.findErrorOption(result.cause);
							assert(Option.isSome(failure));
							expect(failure.value).toMatchObject({ _tag: "ConfigError" });
							const message = Cause.pretty(result.cause);
							expect(message).toContain("DATABASE_POOL_MAX");
							expect(message).toContain("SANDBOX_WORKER_CONCURRENCY");
							expect(message).toContain("application pool");
							expect(message).toContain("sandbox host database dispatch connection");
						}
					}),
			);
		});
	}

	for (const value of [0, -1, 1.5, Number.NaN]) {
		for (const key of [
			"SANDBOX_WORKER_CONCURRENCY",
			"SANDBOX_IMPORT_CONCURRENCY",
			"SANDBOX_MEMORY_BUDGET_MIB",
		]) {
			layer(makeRequiredConfigLayer({ [key]: value }))((test) => {
				test.effect(`rejects ${key} ${value}`, () =>
					Effect.gen(function* () {
						const result = yield* loaded;
						assert(Exit.isFailure(result));
						const failure = Cause.findErrorOption(result.cause);
						assert(Option.isSome(failure));
						expect(failure.value).toMatchObject({ _tag: "ConfigError" });
						expect(Cause.pretty(result.cause)).toContain(key);
					}),
				);
			});
		}
	}
});

describe("FRONTEND_URL validation", () => {
	layer(makeRequiredConfigLayer({ FRONTEND_URL: "https://ryot.example/" }))((test) => {
		test.effect("normalizes an absolute HTTP origin", () =>
			Effect.gen(function* () {
				const result = yield* loaded;
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
		layer(makeRequiredConfigLayer({ FRONTEND_URL: frontendUrl }))((test) => {
			test.effect(`accepts plain-HTTP origin ${frontendUrl} for self-hosters without TLS`, () =>
				Effect.gen(function* () {
					const result = yield* loaded;
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
		layer(makeRequiredConfigLayer({ FRONTEND_URL: frontendUrl }))((test) => {
			test.effect(`rejects non-origin value ${frontendUrl}`, () =>
				Effect.gen(function* () {
					const result = yield* loaded;
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
					const result = yield* loaded;
					expect(Exit.isSuccess(result)).toBe(true);
				}),
			);
		});
	}

	for (const endpoint of ["collector.example", "ftp://collector.example", "127.0.0.1:4318"]) {
		layer(otlpEndpointLayer(endpoint))((test) => {
			test.effect(`rejects non-HTTP endpoint ${endpoint}`, () =>
				Effect.gen(function* () {
					const result = yield* loaded;
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
					const result = yield* loaded;
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
						const result = yield* loaded;
						assert(Exit.isFailure(result));
						expect(Cause.pretty(result.cause)).toContain("without an OTLP signal path");
					}),
			);
		});
	}
});

const egressAllowedNetworksLayer = (value: string) =>
	makeRequiredConfigLayer({ SERVER_EGRESS_ALLOWED_NETWORKS: value });

describe("SERVER_EGRESS_ALLOWED_NETWORKS validation", () => {
	layer(
		makeRequiredConfigLayer({
			SERVER_EGRESS_ALLOWED_NETWORKS: " 127.0.0.1/32, ::1/128 ,10.0.0.0/8,fd00::/8,0.0.0.0/0",
		}),
	)((test) => {
		test.effect("loads a comma-separated list of CIDR networks", () =>
			Effect.gen(function* () {
				const result = yield* loaded;
				assert(Exit.isSuccess(result));
				expect(result.value.server.egressAllowedNetworks).toEqual(
					["127.0.0.1/32", "::1/128", "10.0.0.0/8", "fd00::/8", "0.0.0.0/0"].map(
						IpNetwork.fromStringUnsafe,
					),
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
					const result = yield* loaded;
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
	for (const values of [{}, { OTEL_EXPORTER_OTLP_HEADERS: "" }]) {
		layer(makeRequiredConfigLayer(values))((test) => {
			test.effect("keeps absent or empty deployment headers disabled", () =>
				Effect.gen(function* () {
					const result = yield* loaded;
					assert(Exit.isSuccess(result));
					expect(result.value.observability.otlp.headers).toEqual(Option.none());
				}),
			);
		});
	}
	layer(
		makeRequiredConfigLayer({
			OTEL_EXPORTER_OTLP_HEADERS: "x-api-key=abc123 , authorization=Basic dXNlcj1wdw==,",
		}),
	)((test) => {
		test.effect("retains parsed, redacted headers including value separators", () =>
			Effect.gen(function* () {
				const result = yield* loaded;
				assert(Exit.isSuccess(result));
				const headers = result.value.observability.otlp.headers;
				assert(Option.isSome(headers));
				expect(Redacted.value(headers.value)).toEqual({
					"x-api-key": "abc123",
					authorization: "Basic dXNlcj1wdw==",
				});
			}),
		);
	});
	for (const [value, message] of [
		["s3cret-token", "entry 1 is not a key=value pair"],
		["x-api-key=", "header 'x-api-key' has an empty value"],
		["x-api-key=   ", "header 'x-api-key' has an empty value"],
		["  ", "it is set but contains no headers"],
		[",", "it is set but contains no headers"],
	] as const) {
		layer(makeRequiredConfigLayer({ OTEL_EXPORTER_OTLP_HEADERS: value }))((test) => {
			test.effect(`rejects malformed headers: '${value}'`, () =>
				Effect.gen(function* () {
					const result = yield* loaded;
					assert(Exit.isFailure(result));
					const error = Cause.pretty(result.cause);
					expect(error).toContain(`OTEL_EXPORTER_OTLP_HEADERS is invalid: ${message}`);
					expect(error).not.toContain("s3cret-token");
				}),
			);
		});
	}
});

describe("automation configuration", () => {
	layer(
		makeRequiredConfigLayer({
			AUTOMATIONS_RETRY_WINDOW_DAYS: 8,
			AUTOMATIONS_HISTORY_RETENTION_DAYS: 7,
		}),
	)((test) => {
		test.effect("rejects history retention shorter than the retry window", () =>
			Effect.gen(function* () {
				expect(Exit.isFailure(yield* loaded)).toBe(true);
			}),
		);
	});

	for (const values of [{ AUTOMATIONS_MAX_DEPTH: 1.5 }, { AUTOMATIONS_MAX_RUNS: 10001 }]) {
		layer(makeRequiredConfigLayer(values))((test) => {
			test.effect("rejects unbounded or fractional recursion limits", () =>
				Effect.gen(function* () {
					expect(Exit.isFailure(yield* loaded)).toBe(true);
				}),
			);
		});
	}
});

describe("normalized optional credentials", () => {
	for (const { name, entries } of [
		{
			name: "OIDC",
			entries: [
				["SERVER_OIDC_CLIENT_ID", "client"],
				["SERVER_OIDC_ISSUER_URL", "https://issuer.example"],
				["SERVER_OIDC_CLIENT_SECRET", "oidc-secret"],
			],
		},
		{
			name: "SMTP",
			entries: [
				["SERVER_SMTP_SERVER", "smtp.example"],
				["SERVER_SMTP_USER", "smtp-user"],
				["SERVER_SMTP_PASSWORD", "smtp-secret"],
			],
		},
	] as const) {
		for (const unset of ["absent", "empty"] as const) {
			for (let mask = 0; mask < 8; mask++) {
				const values = Object.fromEntries(
					entries.flatMap(([key, value], index) => {
						if ((mask & (1 << index)) !== 0) {
							return [[key, value]];
						}
						return unset === "empty" ? [[key, ""]] : [];
					}),
				);
				layer(makeRequiredConfigLayer(values))((test) => {
					test.effect(`${name} mask ${mask} with ${unset} fields`, () =>
						Effect.gen(function* () {
							const result = yield* loaded;
							if (mask > 0 && mask < 7) {
								assert(Exit.isFailure(result));
								expect(Cause.pretty(result.cause)).toContain(
									`Partial ${name} configuration detected`,
								);
								return;
							}
							assert(Exit.isSuccess(result));
							const config = result.value;
							if (name === "OIDC") {
								expect(Option.isSome(config.server.oidc)).toBe(mask === 7);
								if (Option.isSome(config.server.oidc)) {
									expect(config.server.oidc.value.clientId).toBe("client");
									expect(config.server.oidc.value.issuerUrl).toBe("https://issuer.example");
									expect(Redacted.value(config.server.oidc.value.clientSecret)).toBe("oidc-secret");
								}
							} else {
								expect(Option.isSome(config.server.smtp)).toBe(mask === 7);
								if (Option.isSome(config.server.smtp)) {
									expect(config.server.smtp.value.server).toBe("smtp.example");
									expect(config.server.smtp.value.mailbox).toBe("Ryot <no-reply@ryot.io>");
									expect(Redacted.value(config.server.smtp.value.user)).toBe("smtp-user");
									expect(Redacted.value(config.server.smtp.value.password)).toBe("smtp-secret");
								}
							}
						}),
					);
				});
			}
		}
	}
	for (const complete of [false, true]) {
		layer(
			makeRequiredConfigLayer({
				USERS_DISABLE_LOCAL_AUTH: true,
				...(complete
					? {
							SERVER_OIDC_CLIENT_ID: "client",
							SERVER_OIDC_CLIENT_SECRET: "secret",
							SERVER_OIDC_ISSUER_URL: "https://issuer.example",
						}
					: {}),
			}),
		)((test) => {
			test.effect(
				`${complete ? "accepts" : "rejects"} disabled local auth with ${complete ? "complete" : "absent"} OIDC`,
				() =>
					Effect.gen(function* () {
						const result = yield* loaded;
						if (!complete) {
							assert(Exit.isFailure(result));
							expect(Cause.pretty(result.cause)).toContain("USERS_DISABLE_LOCAL_AUTH");
							return;
						}
						assert(Exit.isSuccess(result));
						expect(Option.isSome(result.value.server.oidc)).toBe(true);
						expect(result.value.users.disableLocalAuth).toBe(true);
					}),
			);
		});
	}
	const s3Entries = [
		["FILE_STORAGE_S3_URL", "https://s3.example"],
		["FILE_STORAGE_S3_BUCKET_NAME", "bucket"],
		["FILE_STORAGE_S3_ACCESS_KEY_ID", "access"],
		["FILE_STORAGE_S3_SECRET_ACCESS_KEY", "s3-secret"],
	] as const;
	for (const unset of ["absent", "empty"] as const) {
		for (let mask = 0; mask < 16; mask++) {
			const values = Object.fromEntries(
				s3Entries.flatMap(([key, value], index) => {
					if ((mask & (1 << index)) !== 0) {
						return [[key, value]];
					}
					return unset === "empty" ? [[key, ""]] : [];
				}),
			);
			layer(makeRequiredConfigLayer({ ...values, FILE_STORAGE_S3_REGION: "" }))((test) => {
				test.effect(
					`S3 mask ${mask} with ${unset} fields retains complete credentials or local fallback`,
					() =>
						Effect.gen(function* () {
							const result = yield* loaded;
							assert(Exit.isSuccess(result));
							const config = result.value;
							expect(Option.isSome(config.fileStorage.s3)).toBe(mask === 15);
							expect(config.fileStorage).not.toHaveProperty("accessKeyId");
							if (Option.isSome(config.fileStorage.s3)) {
								expect(config.fileStorage.s3.value.url).toBe("https://s3.example");
								expect(config.fileStorage.s3.value.bucketName).toBe("bucket");
								expect(config.fileStorage.s3.value.region).toEqual(Option.none());
								expect(Redacted.value(config.fileStorage.s3.value.accessKeyId)).toBe("access");
								expect(Redacted.value(config.fileStorage.s3.value.secretAccessKey)).toBe(
									"s3-secret",
								);
							}
						}),
				);
			});
		}
	}
});
