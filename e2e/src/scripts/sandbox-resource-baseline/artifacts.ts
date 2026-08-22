import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { Data, Effect, Schema } from "effect";

import { CadenceGateResult, CadenceStatistics } from "./cadence";
import { ScenarioDefinition } from "./scenarios";

export class ArtifactWriteError extends Data.TaggedError("ArtifactWriteError")<{
	readonly path: string;
	readonly cause: unknown;
}> {}

export const ScenarioOutcome = Schema.Literals(["completed", "failed", "aborted", "skipped"]);
export type ScenarioOutcome = typeof ScenarioOutcome.Type;
export const RequestOutcome = Schema.Literals(["completed", "failed", "timeout", "aborted"]);

/** Execution, job and external IDs stay in the raw run only; artifacts carry a truncated digest. */
export const identifierDigest = (value: string) =>
	createHash("sha256").update(value).digest("hex").slice(0, 16);

const NullableNumber = Schema.NullOr(Schema.Finite);

export const ScenarioRequest = Schema.Struct({
	wave: Schema.Int,
	index: Schema.Int,
	outcome: RequestOutcome,
	latencyMs: Schema.Finite,
	startedAtMs: Schema.Finite,
	terminalAtMs: Schema.Finite,
	queueWaitMs: NullableNumber,
	executionMs: NullableNumber,
	attempts: Schema.NullOr(Schema.Int),
	failureCode: Schema.NullOr(Schema.String),
	failureStage: Schema.NullOr(Schema.String),
	identityDigest: Schema.NullOr(Schema.String),
	responseByteLength: Schema.NullOr(Schema.Int),
});
export type ScenarioRequest = typeof ScenarioRequest.Type;

export const AppPoint = Schema.Struct({
	t: Schema.Finite,
	workers: Schema.Int,
	bunRss: Schema.Finite,
	denoRss: Schema.Finite,
	bunHeapUsed: Schema.Finite,
	bunExternal: Schema.Finite,
	bunHeapTotal: Schema.Finite,
	activeExecutions: Schema.Int,
	cgroupCurrent: NullableNumber,
	bunArrayBuffers: Schema.Finite,
	executingImportBodies: Schema.Int,
});
export type AppPoint = typeof AppPoint.Type;

export const HostPoint = Schema.Struct({
	t: Schema.Finite,
	ioSomeAvg10: NullableNumber,
	memAvailable: NullableNumber,
	cpuSomeAvg10: NullableNumber,
	memorySomeAvg10: NullableNumber,
	memoryFullAvg10: NullableNumber,
	ryotMemoryCurrent: NullableNumber,
	otelMemoryCurrent: NullableNumber,
	redisMemoryCurrent: NullableNumber,
	postgresMemoryCurrent: NullableNumber,
});
export type HostPoint = typeof HostPoint.Type;

export const MetricValues = Schema.Record(Schema.String, NullableNumber);
export type MetricValues = typeof MetricValues.Type;

export const WorkerLifecycle = Schema.Struct({
	spawned: Schema.Int,
	completed: Schema.Int,
	sampledWorkerCount: Schema.Int,
	lifetimePeakUnobserved: Schema.Int,
	sampledPeakRssBytes: Schema.Array(Schema.Finite),
	lifetimePeakRssBytes: Schema.Array(Schema.Finite),
});

export const PhaseSummary = Schema.Struct({
	executions: Schema.Int,
	replayedSegments: Schema.Int,
	maxConcurrentAnyPhase: Schema.Int,
	populationAutomationOverlapMs: Schema.Finite,
	phases: Schema.Array(
		Schema.Struct({
			count: Schema.Int,
			failed: Schema.Int,
			phase: Schema.String,
			maxConcurrent: Schema.Int,
			durationMs: Schema.Struct({ p50: Schema.Finite, p95: Schema.Finite, max: Schema.Finite }),
		}),
	),
});
export type PhaseSummary = typeof PhaseSummary.Type;

export const ImportAccounting = Schema.Struct({
	terminal: Schema.Int,
	submitted: Schema.Int,
	completed: Schema.Int,
	maxLogicalPending: Schema.Int,
	failedByStage: Schema.Record(Schema.String, Schema.Int),
});
export type ImportAccounting = typeof ImportAccounting.Type;

export const WaveSummary = Schema.Struct({
	wave: Schema.Int,
	failed: Schema.Int,
	requests: Schema.Int,
	terminalAtMs: Schema.Finite,
	submittedAtMs: Schema.Finite,
	drainedAfterMs: NullableNumber,
	checkpoints: Schema.Array(
		Schema.Struct({ afterMs: Schema.Int, label: Schema.String, values: MetricValues }),
	),
});
export type WaveSummary = typeof WaveSummary.Type;

export const ScenarioArtifact = Schema.Struct({
	runId: Schema.String,
	metrics: MetricValues,
	repetition: Schema.Int,
	outcome: ScenarioOutcome,
	workers: WorkerLifecycle,
	scenarioId: Schema.String,
	invocationId: Schema.String,
	schemaVersion: Schema.Literal(2),
	round: Schema.NullOr(Schema.Int),
	configuration: ScenarioDefinition,
	notes: Schema.Array(Schema.String),
	phases: Schema.NullOr(PhaseSummary),
	orderInRound: Schema.NullOr(Schema.Int),
	requests: Schema.Array(ScenarioRequest),
	profileIds: Schema.Array(Schema.String),
	stopReason: Schema.NullOr(Schema.String),
	imports: Schema.NullOr(ImportAccounting),
	waves: Schema.NullOr(Schema.Array(WaveSummary)),
	series: Schema.Struct({ host: Schema.Array(HostPoint), application: Schema.Array(AppPoint) }),
	peakReset: Schema.NullOr(Schema.Struct({ verified: Schema.Boolean, supported: Schema.Boolean })),
	journal: Schema.Struct({
		lineCount: Schema.Int,
		truncated: Schema.Boolean,
		lines: Schema.Array(Schema.String),
	}),
	watchdog: Schema.Struct({
		triggered: Schema.Boolean,
		triggers: Schema.Array(Schema.Record(Schema.String, Schema.Unknown)),
	}),
	containers: Schema.Struct({
		after: Schema.Array(Schema.Record(Schema.String, Schema.Unknown)),
		before: Schema.Array(Schema.Record(Schema.String, Schema.Unknown)),
	}),
	cadence: Schema.Struct({
		application: CadenceStatistics,
		undecodableHostLines: Schema.Int,
		applicationSampleFailures: Schema.Int,
		host: Schema.NullOr(CadenceStatistics),
	}),
	timeline: Schema.Struct({
		startedAtMs: Schema.Finite,
		terminalAtMs: Schema.Finite,
		submittedAtMs: Schema.Finite,
		completedAtMs: Schema.Finite,
		preScenarioAtMs: Schema.Finite,
	}),
	effective: Schema.Struct({
		bunVersion: Schema.String,
		denoVersion: Schema.String,
		processMode: Schema.String,
		workerConcurrency: Schema.Int,
		imageDigest: Schema.NullOr(Schema.String),
		benchmarkProfilingEnabled: Schema.Boolean,
		schedulerDispatchersDisabled: Schema.Boolean,
	}),
});
export type ScenarioArtifact = typeof ScenarioArtifact.Type;

export const ManifestInvocation = Schema.Struct({
	command: Schema.String,
	invocationId: Schema.String,
	startedAtUtc: Schema.String,
	scenarioIds: Schema.Array(Schema.String),
	stopReason: Schema.NullOr(Schema.String),
	completedAtUtc: Schema.NullOr(Schema.String),
	outcome: Schema.Literals(["running", "completed", "stopped", "failed"]),
});
export type ManifestInvocation = typeof ManifestInvocation.Type;

export const RunManifest = Schema.Struct({
	runId: Schema.String,
	startedAtUtc: Schema.String,
	schemaVersion: Schema.Literal(2),
	prNumber: Schema.NullOr(Schema.Int),
	branch: Schema.NullOr(Schema.String),
	deviations: Schema.Array(Schema.String),
	completedAtUtc: Schema.NullOr(Schema.String),
	invocations: Schema.Array(ManifestInvocation),
	/** Constituent run IDs whose artifacts this run may merge; always contains `runId`. */
	constituentRunIds: Schema.Array(Schema.String),
	host: Schema.Record(Schema.String, Schema.Unknown),
	teardown: Schema.NullOr(Schema.Record(Schema.String, Schema.Unknown)),
	preflight: Schema.NullOr(Schema.Record(Schema.String, Schema.Unknown)),
	watchdogDrill: Schema.NullOr(Schema.Record(Schema.String, Schema.Unknown)),
	counterbalancedOrders: Schema.Record(Schema.String, Schema.Array(Schema.Array(Schema.Int))),
	retentionTolerance: Schema.Struct({
		postGcGrowthRatio: Schema.Finite,
		slopeBytesPerThousandOperations: Schema.Finite,
	}),
	runtime: Schema.Struct({
		bunVersion: Schema.NullOr(Schema.String),
		denoVersion: Schema.NullOr(Schema.String),
		effectVersion: Schema.NullOr(Schema.String),
	}),
	commits: Schema.Struct({
		ciTrigger: Schema.NullOr(Schema.String),
		implementation: Schema.NullOr(Schema.String),
		workflowRunUrl: Schema.NullOr(Schema.String),
	}),
	profiles: Schema.Struct({
		rawDeleted: Schema.NullOr(Schema.Boolean),
		verifiedAtUtc: Schema.NullOr(Schema.String),
		remainingRawEntries: Schema.NullOr(Schema.Int),
	}),
	image: Schema.Struct({
		tag: Schema.NullOr(Schema.String),
		digest: Schema.NullOr(Schema.String),
		ociRevision: Schema.NullOr(Schema.String),
		architecture: Schema.NullOr(Schema.String),
	}),
	deployment: Schema.Struct({
		otelCollectorImage: Schema.NullOr(Schema.String),
		redactedComposeSha256: Schema.NullOr(Schema.String),
		resourceSettings: Schema.Record(Schema.String, Schema.String),
	}),
	sampling: Schema.Struct({
		hostIntervalMs: Schema.Int,
		applicationIntervalMs: Schema.Int,
		hostGate: Schema.Record(Schema.String, Schema.Finite),
		applicationGate: Schema.Record(Schema.String, Schema.Finite),
	}),
});
export type RunManifest = typeof RunManifest.Type;

export const MetricAggregate = Schema.Struct({
	n: Schema.Int,
	p95: NullableNumber,
	min: NullableNumber,
	max: NullableNumber,
	median: NullableNumber,
});
export type MetricAggregate = typeof MetricAggregate.Type;

export const ScenarioAggregate = Schema.Struct({
	kind: Schema.String,
	repetitions: Schema.Int,
	scenarioId: Schema.String,
	workerConcurrency: Schema.Int,
	requiredRepetitions: Schema.Int,
	metrics: Schema.Record(Schema.String, MetricAggregate),
	outcomes: Schema.Struct({
		failed: Schema.Int,
		aborted: Schema.Int,
		skipped: Schema.Int,
		completed: Schema.Int,
	}),
	repetitionResults: Schema.Array(
		Schema.Struct({
			metrics: MetricValues,
			repetition: Schema.Int,
			outcome: ScenarioOutcome,
			stopReason: Schema.NullOr(Schema.String),
		}),
	),
});
export type ScenarioAggregate = typeof ScenarioAggregate.Type;

export const ScalingRatio = Schema.Struct({
	metric: Schema.String,
	ratio: NullableNumber,
	baselineMedian: NullableNumber,
	comparedMedian: NullableNumber,
	baselineScenarioId: Schema.String,
	comparedScenarioId: Schema.String,
	unavailableReason: Schema.NullOr(Schema.String),
});
export type ScalingRatio = typeof ScalingRatio.Type;

export const RunSummary = Schema.Struct({
	runId: Schema.String,
	schemaVersion: Schema.Literal(2),
	scalingRatios: Schema.Array(ScalingRatio),
	scenarios: Schema.Array(ScenarioAggregate),
	extra: Schema.Record(Schema.String, Schema.Unknown),
});
export type RunSummary = typeof RunSummary.Type;

export { CadenceGateResult };

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

export const writeRawJson = (path: string, value: unknown) =>
	Effect.tryPromise({
		catch: (cause) => new ArtifactWriteError({ path, cause }),
		try: async () => {
			await mkdir(dirname(path), { mode: 0o700, recursive: true });
			await writeFile(path, `${JSON.stringify(value)}\n`, { mode: 0o600 });
		},
	});

export const writeText = (path: string, contents: string) => writeAtomic(path, contents);

export const artifactPaths = (outputDirectory: string) => ({
	reportPath: join(outputDirectory, "report.md"),
	defectsPath: join(outputDirectory, "defects.md"),
	summaryPath: join(outputDirectory, "summary.json"),
	manifestPath: join(outputDirectory, "manifest.json"),
	scenariosDirectory: join(outputDirectory, "scenarios"),
	profilesSummaryPath: join(outputDirectory, "profiles", "summary.json"),
});

export const scenarioFileName = (scenarioId: string, repetition: number) =>
	`${scenarioId}.${repetition}.json`;
