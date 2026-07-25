import { Schema } from "effect";

export const CANONICAL_BENCHMARK_HOSTNAME = "ur-testing.ryot.io";

export const DriverConfig = Schema.Struct({
	runId: Schema.String,
	apiUrl: Schema.String,
	frontendUrl: Schema.String,
	sampleIntervalMs: Schema.Int,
	recoveryWindowMs: Schema.Int,
	requestTimeoutMs: Schema.Int,
	outputDirectory: Schema.String,
	adminAccessToken: Schema.String,
	hostSampleIntervalMs: Schema.Int,
	allowNonCanonicalHost: Schema.Boolean,
	scenarioIds: Schema.Array(Schema.String),
	manifestFile: Schema.NullOr(Schema.String),
	hostSampleFile: Schema.NullOr(Schema.String),
	stabilization: Schema.Struct({
		windowMs: Schema.Int,
		maxWaitMs: Schema.Int,
		maxDriftRatio: Schema.Finite,
	}),
	manifest: Schema.Struct({
		prNumber: Schema.NullOr(Schema.Int),
		branch: Schema.NullOr(Schema.String),
		imageTag: Schema.NullOr(Schema.String),
		imageDigest: Schema.NullOr(Schema.String),
		ociRevision: Schema.NullOr(Schema.String),
		ciTriggerCommit: Schema.NullOr(Schema.String),
		implementationCommit: Schema.NullOr(Schema.String),
	}),
});
export type DriverConfig = typeof DriverConfig.Type;

export class DriverConfigError extends Error {
	override readonly name = "DriverConfigError";
}

type Environment = Readonly<Record<string, string | undefined>>;

const required = (environment: Environment, name: string) => {
	const value = environment[name];
	if (value === undefined || value.trim() === "") {
		throw new DriverConfigError(`${name} is required`);
	}
	return value.trim();
};

const optional = (environment: Environment, name: string) => {
	const value = environment[name];
	return value === undefined || value.trim() === "" ? null : value.trim();
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

const boolean = (environment: Environment, name: string) => {
	const value = optional(environment, name);
	return value === "1" || value === "true";
};

const utcRunId = (isoTimestamp: string) => isoTimestamp.replace(/[:.]/g, "-").replace(/Z$/, "Z");

export const readDriverConfig = (environment: Environment, nowIso: string): DriverConfig => {
	const apiUrl = required(environment, "BENCHMARK_API_URL");
	const allowNonCanonicalHost = boolean(environment, "BENCHMARK_ALLOW_NON_CANONICAL_HOST");
	const hostname = new URL(apiUrl).hostname;
	if (hostname !== CANONICAL_BENCHMARK_HOSTNAME && !allowNonCanonicalHost) {
		throw new DriverConfigError(
			`BENCHMARK_API_URL host '${hostname}' is not '${CANONICAL_BENCHMARK_HOSTNAME}'; set BENCHMARK_ALLOW_NON_CANONICAL_HOST=1 for local development`,
		);
	}
	const scenarioIds = optional(environment, "BENCHMARK_SCENARIOS");
	return {
		apiUrl,
		allowNonCanonicalHost,
		frontendUrl: required(environment, "BENCHMARK_FRONTEND_URL"),
		outputDirectory: required(environment, "BENCHMARK_OUTPUT_DIR"),
		manifestFile: optional(environment, "BENCHMARK_MANIFEST_FILE"),
		hostSampleFile: optional(environment, "BENCHMARK_HOST_SAMPLE_FILE"),
		runId: optional(environment, "BENCHMARK_RUN_ID") ?? utcRunId(nowIso),
		adminAccessToken: required(environment, "BENCHMARK_ADMIN_ACCESS_TOKEN"),
		sampleIntervalMs: integer(environment, "BENCHMARK_SAMPLE_INTERVAL_MS", 200),
		recoveryWindowMs: integer(environment, "BENCHMARK_RECOVERY_WINDOW_MS", 300_000),
		requestTimeoutMs: integer(environment, "BENCHMARK_REQUEST_TIMEOUT_MS", 900_000),
		hostSampleIntervalMs: integer(environment, "BENCHMARK_HOST_SAMPLE_INTERVAL_MS", 1_000),
		scenarioIds:
			scenarioIds === null
				? []
				: scenarioIds
						.split(",")
						.map((entry) => entry.trim())
						.filter(Boolean),
		stabilization: {
			maxDriftRatio: 0.05,
			windowMs: integer(environment, "BENCHMARK_STABILIZE_WINDOW_MS", 120_000),
			maxWaitMs: integer(environment, "BENCHMARK_STABILIZE_MAX_WAIT_MS", 600_000),
		},
		manifest: {
			branch: optional(environment, "BENCHMARK_BRANCH"),
			imageTag: optional(environment, "BENCHMARK_IMAGE_TAG"),
			imageDigest: optional(environment, "BENCHMARK_IMAGE_DIGEST"),
			ociRevision: optional(environment, "BENCHMARK_OCI_REVISION"),
			ciTriggerCommit: optional(environment, "BENCHMARK_CI_COMMIT"),
			implementationCommit: optional(environment, "BENCHMARK_IMPLEMENTATION_COMMIT"),
			prNumber:
				optional(environment, "BENCHMARK_PR_NUMBER") === null
					? null
					: integer(environment, "BENCHMARK_PR_NUMBER", 0),
		},
	};
};
