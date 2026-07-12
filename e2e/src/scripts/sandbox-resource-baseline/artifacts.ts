import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { TestSupportSandboxRuntimeMetrics } from "@ryot-app/contract/modules/test-support/schemas";
import { Data, Effect, Schema } from "effect";

import { ScenarioDefinition } from "./scenarios";
import { ScenarioStatistics } from "./statistics";

export class ArtifactWriteError extends Data.TaggedError("ArtifactWriteError")<{
	readonly path: string;
	readonly cause: unknown;
}> {}

export const ScenarioOutcome = Schema.Literals(["completed", "failed", "aborted", "skipped"]);
export const RequestOutcome = Schema.Literals(["completed", "failed", "timeout", "aborted"]);

/** Execution and trace IDs stay in the raw run only; artifacts carry a truncated digest. */
export const identifierDigest = (value: string) =>
	createHash("sha256").update(value).digest("hex").slice(0, 16);

export const ScenarioRequest = Schema.Struct({
	index: Schema.Int,
	outcome: RequestOutcome,
	latencyMs: Schema.Finite,
	startedAtMs: Schema.Finite,
	terminalAtMs: Schema.Finite,
	failureCode: Schema.NullOr(Schema.String),
	failureStage: Schema.NullOr(Schema.String),
	responseByteLength: Schema.NullOr(Schema.Int),
	executionIdDigest: Schema.NullOr(Schema.String),
});
export type ScenarioRequest = typeof ScenarioRequest.Type;

export const HostSample = Schema.Record(Schema.String, Schema.Unknown);

export const ScenarioArtifact = Schema.Struct({
	runId: Schema.String,
	repetition: Schema.Int,
	outcome: ScenarioOutcome,
	scenarioId: Schema.String,
	startedAtMs: Schema.Finite,
	terminalAtMs: Schema.Finite,
	completedAtMs: Schema.Finite,
	submittedAtMs: Schema.Finite,
	statistics: ScenarioStatistics,
	configuration: ScenarioDefinition,
	hostSamples: Schema.Array(HostSample),
	requests: Schema.Array(ScenarioRequest),
	stopReason: Schema.NullOr(Schema.String),
	/** Set when a Group E restart was observed through a lifecycle counter reset. */
	restartDetectedAfterMs: Schema.NullOr(Schema.Finite),
	applicationSamples: Schema.Array(TestSupportSandboxRuntimeMetrics),
});
export type ScenarioArtifact = typeof ScenarioArtifact.Type;

export const ManifestImage = Schema.Struct({
	tag: Schema.NullOr(Schema.String),
	digest: Schema.NullOr(Schema.String),
	ociRevision: Schema.NullOr(Schema.String),
	architecture: Schema.NullOr(Schema.String),
});

export const ManifestRuntime = Schema.Struct({
	bunVersion: Schema.NullOr(Schema.String),
	denoVersion: Schema.NullOr(Schema.String),
});

export const ManifestHost = Schema.Struct({
	cpuCount: Schema.NullOr(Schema.Int),
	kernel: Schema.NullOr(Schema.String),
	cpuModel: Schema.NullOr(Schema.String),
	ramBytes: Schema.NullOr(Schema.Finite),
	swapBytes: Schema.NullOr(Schema.Finite),
	diskBytes: Schema.NullOr(Schema.Finite),
	filesystem: Schema.NullOr(Schema.String),
	dockerVersion: Schema.NullOr(Schema.String),
	cgroupVersion: Schema.NullOr(Schema.String),
});

export const ManifestDeployment = Schema.Struct({
	redactedComposeSha256: Schema.NullOr(Schema.String),
	/** Non-secret, resource-relevant settings only; never a complete environment response. */
	resourceSettings: Schema.Record(Schema.String, Schema.String),
});

export const ManifestHealth = Schema.Struct({
	otlpHealthy: Schema.Boolean,
	watchdogHealthy: Schema.Boolean,
	hostSamplerHealthy: Schema.Boolean,
});

/** Facts the driver cannot observe over HTTP; the operator collects them on the VM. */
export const RunManifestFacts = Schema.Struct({
	host: ManifestHost,
	image: ManifestImage,
	health: ManifestHealth,
	runtime: ManifestRuntime,
	deployment: ManifestDeployment,
});
export type RunManifestFacts = typeof RunManifestFacts.Type;

export const EMPTY_MANIFEST_FACTS: RunManifestFacts = {
	runtime: { bunVersion: null, denoVersion: null },
	deployment: { resourceSettings: {}, redactedComposeSha256: null },
	image: { tag: null, digest: null, ociRevision: null, architecture: null },
	health: { otlpHealthy: false, watchdogHealthy: false, hostSamplerHealthy: false },
	host: {
		kernel: null,
		cpuCount: null,
		cpuModel: null,
		ramBytes: null,
		diskBytes: null,
		swapBytes: null,
		filesystem: null,
		dockerVersion: null,
		cgroupVersion: null,
	},
};

export const RunManifest = Schema.Struct({
	...RunManifestFacts.fields,
	runId: Schema.String,
	startedAtUtc: Schema.String,
	sampleIntervalMs: Schema.Int,
	hostSampleIntervalMs: Schema.Int,
	prNumber: Schema.NullOr(Schema.Int),
	branch: Schema.NullOr(Schema.String),
	scenarios: Schema.Array(ScenarioDefinition),
	completedAtUtc: Schema.NullOr(Schema.String),
	commits: Schema.Struct({
		ciTrigger: Schema.NullOr(Schema.String),
		implementation: Schema.NullOr(Schema.String),
	}),
});
export type RunManifest = typeof RunManifest.Type;

const ScalingRatio = Schema.Struct({
	delta: Schema.Finite,
	metric: Schema.String,
	baselineValue: Schema.Finite,
	comparedValue: Schema.Finite,
	baselineScenarioId: Schema.String,
	comparedScenarioId: Schema.String,
	ratio: Schema.NullOr(Schema.Finite),
});

export const RunSummary = Schema.Struct({
	runId: Schema.String,
	scalingRatios: Schema.Array(ScalingRatio),
	scenarios: Schema.Array(
		Schema.Struct({
			repetitions: Schema.Int,
			concurrency: Schema.Int,
			outcome: ScenarioOutcome,
			requestCount: Schema.Int,
			failureCount: Schema.Int,
			successCount: Schema.Int,
			scenarioId: Schema.String,
			peakWorkerCount: Schema.Int,
			replayJournalBytes: Schema.Finite,
			peakBackendRssBytes: Schema.Finite,
			peakDenoAggregateRssBytes: Schema.Finite,
			stopReason: Schema.NullOr(Schema.String),
			recoveredAfterMs: Schema.NullOr(Schema.Finite),
			latencyMs: Schema.Struct({ p50: Schema.Finite, p95: Schema.Finite }),
		}),
	),
});
export type RunSummary = typeof RunSummary.Type;

const writeAtomic = (path: string, contents: string) =>
	Effect.tryPromise({
		catch: (cause) => new ArtifactWriteError({ path, cause }),
		try: async () => {
			await mkdir(dirname(path), { recursive: true });
			const temporaryPath = `${path}.${randomUUID()}.tmp`;
			await writeFile(temporaryPath, contents, "utf8");
			await rename(temporaryPath, path);
		},
	});

/** Every artifact is schema-validated on write so a malformed run fails loudly at the boundary. */
export const writeArtifact = <S extends Schema.Top>(schema: S, path: string, value: S["Type"]) =>
	Schema.encodeUnknownEffect(schema)(value).pipe(
		Effect.flatMap((encoded) => writeAtomic(path, `${JSON.stringify(encoded, null, 2)}\n`)),
	);

export const writeRawRun = (path: string, value: unknown) =>
	writeAtomic(path, `${JSON.stringify(value, null, 2)}\n`);

export const writeText = (path: string, contents: string) => writeAtomic(path, contents);

export const artifactPaths = (outputDirectory: string) => ({
	rawDirectory: join(outputDirectory, "raw"),
	reportPath: join(outputDirectory, "report.md"),
	summaryPath: join(outputDirectory, "summary.json"),
	manifestPath: join(outputDirectory, "manifest.json"),
	scenariosDirectory: join(outputDirectory, "scenarios"),
});
