import type { RunManifest, ScenarioArtifact } from "./artifacts";
import { cadenceStatistics } from "./cadence";
import { findScenario } from "./scenarios";

export const scenarioArtifact = (
	overrides: Partial<ScenarioArtifact> & Pick<ScenarioArtifact, "scenarioId" | "repetition">,
): ScenarioArtifact => {
	const configuration = findScenario(overrides.scenarioId);
	return {
		notes: [],
		round: null,
		waves: null,
		metrics: {},
		phases: null,
		requests: [],
		imports: null,
		configuration,
		profileIds: [],
		runId: "run-1",
		peakReset: null,
		stopReason: null,
		schemaVersion: 2,
		orderInRound: null,
		outcome: "completed",
		invocationId: "invocation-1",
		series: { host: [], application: [] },
		containers: { after: [], before: [] },
		watchdog: { triggers: [], triggered: false },
		journal: { lines: [], lineCount: 0, truncated: false },
		timeline: {
			startedAtMs: 0,
			terminalAtMs: 0,
			submittedAtMs: 0,
			completedAtMs: 0,
			preScenarioAtMs: 0,
		},
		workers: {
			spawned: 0,
			completed: 0,
			sampledWorkerCount: 0,
			sampledPeakRssBytes: [],
			lifetimePeakRssBytes: [],
			lifetimePeakUnobserved: 0,
		},
		effective: {
			bunVersion: "1.4.0",
			denoVersion: "2.8.1",
			processMode: "on-demand",
			imageDigest: "sha256:image",
			benchmarkProfilingEnabled: true,
			workerConcurrency: configuration.workerConcurrency,
			schedulerDispatchersDisabled: configuration.schedulerDispatchersDisabled,
		},
		cadence: {
			undecodableHostLines: 0,
			applicationSampleFailures: 0,
			host: cadenceStatistics(
				[{ startedMs: 0, durationMs: 1, scheduledMs: 0, missedSlotsBefore: 0 }],
				1_000,
			),
			application: cadenceStatistics(
				[{ startedMs: 0, durationMs: 1, scheduledMs: 0, missedSlotsBefore: 0 }],
				200,
			),
		},
		...overrides,
	};
};

export const runManifest = (overrides: Partial<RunManifest> = {}): RunManifest => ({
	host: {},
	branch: null,
	prNumber: null,
	teardown: null,
	deviations: [],
	runId: "run-1",
	preflight: null,
	schemaVersion: 2,
	watchdogDrill: null,
	completedAtUtc: null,
	counterbalancedOrders: {},
	constituentRunIds: ["run-1"],
	startedAtUtc: "2026-09-19T00:00:00.000Z",
	commits: { ciTrigger: null, implementation: null, workflowRunUrl: null },
	runtime: { bunVersion: "1.4.0", effectVersion: null, denoVersion: "2.8.1" },
	profiles: { rawDeleted: null, verifiedAtUtc: null, remainingRawEntries: null },
	image: { tag: null, ociRevision: null, architecture: null, digest: "sha256:image" },
	deployment: { resourceSettings: {}, otelCollectorImage: null, redactedComposeSha256: null },
	retentionTolerance: { postGcGrowthRatio: 0.1, slopeBytesPerThousandOperations: 104_857_600 },
	sampling: {
		hostGate: {},
		applicationGate: {},
		hostIntervalMs: 1_000,
		applicationIntervalMs: 200,
	},
	invocations: [
		{
			scenarioIds: [],
			stopReason: null,
			command: "hermetic",
			outcome: "completed",
			completedAtUtc: null,
			invocationId: "invocation-1",
			startedAtUtc: "2026-09-19T00:00:00.000Z",
		},
	],
	...overrides,
});
