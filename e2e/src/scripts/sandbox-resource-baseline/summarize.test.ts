import { describe, expect, it } from "~/support/effect-test";

import type { ScenarioArtifact, ScenarioRequest } from "./artifacts";
import { CANONICAL_SCENARIOS } from "./scenarios";
import type { ScenarioStatistics } from "./statistics";
import { buildRunSummary } from "./summarize";

const statistics = (overrides: {
	peakBackendRss?: number;
	peakDenoRss?: number;
	journalBytes?: number;
}): ScenarioStatistics => ({
	cgroup: null,
	sampleCount: 1,
	peakWorkerCount: 1,
	workerPeakRssBytes: [],
	backendHeapUsedPeakBytes: 0,
	backendExternalPeakBytes: 0,
	workerRssBytes: { p50: 0, p95: 0, peak: 0 },
	backendRssBytes: { p50: 0, p95: 0, peak: overrides.peakBackendRss ?? 0 },
	denoAggregateRssBytes: { p50: 0, p95: 0, peak: overrides.peakDenoRss ?? 0 },
	recovery: {
		thresholdBytes: 0,
		recoveredAfterMs: null,
		workersDrainedAfterMs: null,
		preScenarioBackendRssBytes: 0,
	},
	cpuDeltas: {
		denoUserTicks: null,
		cgroupUserUsec: null,
		denoSystemTicks: null,
		cgroupUsageUsec: null,
		cgroupSystemUsec: null,
		backendUserMicros: null,
		backendSystemMicros: null,
	},
	counterDeltas: {
		totalSpawned: 0,
		replaysFailed: 0,
		totalCompleted: 0,
		replaysStarted: 0,
		executionsTotal: 0,
		replaysCompleted: 0,
		executionsMaxActive: 0,
		replayJournalBytes: overrides.journalBytes ?? 0,
	},
});

const request = (index: number, latencyMs: number, failed = false): ScenarioRequest => ({
	index,
	latencyMs,
	startedAtMs: 0,
	failureCode: null,
	terminalAtMs: latencyMs,
	responseByteLength: null,
	executionIdDigest: "digest",
	outcome: failed ? "failed" : "completed",
	failureStage: failed ? "population" : null,
});

const artifact = (input: {
	scenarioId: string;
	repetition?: number;
	requests?: ReadonlyArray<ScenarioRequest>;
	statistics: ScenarioStatistics;
}): ScenarioArtifact => {
	const configuration = CANONICAL_SCENARIOS.find(({ id }) => id === input.scenarioId);
	if (configuration === undefined) {
		throw new Error(`Unknown canonical scenario '${input.scenarioId}'`);
	}
	return {
		runId: "run",
		configuration,
		startedAtMs: 0,
		terminalAtMs: 0,
		hostSamples: [],
		submittedAtMs: 0,
		completedAtMs: 0,
		stopReason: null,
		outcome: "completed",
		applicationSamples: [],
		restartDetectedAfterMs: null,
		statistics: input.statistics,
		scenarioId: input.scenarioId,
		repetition: input.repetition ?? 1,
		requests: input.requests ?? [request(0, 10)],
	};
};

describe("buildRunSummary", () => {
	it("aggregates repetitions of one scenario into a single row", () => {
		const summary = buildRunSummary("run", [
			artifact({
				repetition: 1,
				statistics: statistics({}),
				scenarioId: "01-direct-no-host",
				requests: [request(0, 10), request(1, 30, true)],
			}),
			artifact({
				repetition: 2,
				statistics: statistics({}),
				requests: [request(0, 20)],
				scenarioId: "01-direct-no-host",
			}),
		]);

		expect(summary.scenarios).toHaveLength(1);
		expect(summary.scenarios[0]).toMatchObject({
			repetitions: 2,
			requestCount: 3,
			successCount: 2,
			failureCount: 1,
			scenarioId: "01-direct-no-host",
		});
		expect(summary.scenarios[0]?.latencyMs.p50).toBe(20);
	});

	it("computes scaling ratios against the declared baselines", () => {
		const summary = buildRunSummary("run", [
			artifact({ scenarioId: "07-concurrency-1", statistics: statistics({ peakDenoRss: 100 }) }),
			artifact({ scenarioId: "09-concurrency-5", statistics: statistics({ peakDenoRss: 450 }) }),
		]);

		const ratio = summary.scalingRatios.find(
			(candidate) => candidate.comparedScenarioId === "09-concurrency-5",
		);
		expect(ratio?.ratio).toBe(4.5);
		expect(ratio?.delta).toBe(350);
	});

	it("omits comparisons whose baseline or compared scenario never ran", () => {
		const summary = buildRunSummary("run", [
			artifact({ scenarioId: "09-concurrency-5", statistics: statistics({ peakDenoRss: 450 }) }),
		]);

		expect(summary.scalingRatios).toEqual([]);
	});
});
