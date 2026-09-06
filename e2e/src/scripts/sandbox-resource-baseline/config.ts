import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

export const CANONICAL_BENCHMARK_HOSTNAME = "ur-testing.ryot.io";

export type DriverConfig = {
	readonly runId: string;
	readonly apiUrl: string;
	readonly serverIp: string;
	readonly frontendUrl: string;
	readonly rawDirectory: string;
	readonly outputDirectory: string;
	readonly adminAccessToken: string;
	readonly requestTimeoutMs: number;
	readonly imageDigest: string | null;
	readonly allowNonCanonicalHost: boolean;
	readonly stabilization: {
		readonly windowMs: number;
		readonly maxWaitMs: number;
		readonly maxDriftRatio: number;
	};
};

export class DriverConfigError extends Error {
	override readonly name = "DriverConfigError";
}

type Environment = Readonly<Record<string, string | undefined>>;

const optional = (environment: Environment, name: string) => {
	const value = environment[name];
	return value === undefined || value.trim() === "" ? null : value.trim();
};

const required = (environment: Environment, name: string) => {
	const value = optional(environment, name);
	if (value === null) {
		throw new DriverConfigError(`${name} is required`);
	}
	return value;
};

const integer = (environment: Environment, name: string, fallback: number) => {
	const value = optional(environment, name);
	if (value === null) {
		return fallback;
	}
	const parsed = Number.parseInt(value, 10);
	if (!Number.isSafeInteger(parsed) || parsed < 0) {
		throw new DriverConfigError(`${name} must be a non-negative integer`);
	}
	return parsed;
};

const insideRepository = (path: string) => {
	let current = resolve(path);
	for (;;) {
		if (existsSync(`${current}/.git`)) {
			return true;
		}
		const parent = dirname(current);
		if (parent === current) {
			return false;
		}
		current = parent;
	}
};

export const readDriverConfig = (environment: Environment): DriverConfig => {
	const apiUrl = required(environment, "BENCHMARK_API_URL");
	const allowNonCanonicalHost = optional(environment, "BENCHMARK_ALLOW_NON_CANONICAL_HOST") === "1";
	const hostname = new URL(apiUrl).hostname;
	if (hostname !== CANONICAL_BENCHMARK_HOSTNAME && !allowNonCanonicalHost) {
		throw new DriverConfigError(
			`BENCHMARK_API_URL host '${hostname}' is not '${CANONICAL_BENCHMARK_HOSTNAME}'; set BENCHMARK_ALLOW_NON_CANONICAL_HOST=1 for local development`,
		);
	}
	const rawDirectory = required(environment, "BENCHMARK_RAW_DIR");
	if (insideRepository(rawDirectory)) {
		throw new DriverConfigError("BENCHMARK_RAW_DIR must be outside the repository");
	}
	return {
		apiUrl,
		rawDirectory,
		allowNonCanonicalHost,
		serverIp: required(environment, "SERVER_IP"),
		runId: required(environment, "BENCHMARK_RUN_ID"),
		imageDigest: optional(environment, "BENCHMARK_IMAGE_DIGEST"),
		frontendUrl: required(environment, "BENCHMARK_FRONTEND_URL"),
		outputDirectory: required(environment, "BENCHMARK_OUTPUT_DIR"),
		adminAccessToken: required(environment, "BENCHMARK_ADMIN_ACCESS_TOKEN"),
		requestTimeoutMs: integer(environment, "BENCHMARK_REQUEST_TIMEOUT_MS", 1_800_000),
		stabilization: {
			maxDriftRatio: 0.05,
			windowMs: integer(environment, "BENCHMARK_STABILIZE_WINDOW_MS", 120_000),
			maxWaitMs: integer(environment, "BENCHMARK_STABILIZE_MAX_WAIT_MS", 600_000),
		},
	};
};
