import type { RuntimeSample } from "~/support/benchmark-workload";
import { describe, expect, it } from "~/support/effect-test";

import { RECOVERY_WINDOW_MS, summarizeScenario } from "./statistics";

type SampleOverrides = {
	timestampMs: number;
	backendRss: number;
	denoRss: number;
	workers?: ReadonlyArray<{ pid: number; rssBytes: number }>;
	totalSpawned?: number;
	journalBytes?: number;
	oomKill?: number;
	cgroupMemoryCurrent?: number;
	backendUserCpuMicros?: number | null;
};

const sample = (overrides: SampleOverrides): RuntimeSample => {
	const workers = overrides.workers ?? [];
	return {
		totalCompleted: 0,
		timestampMs: overrides.timestampMs,
		activeProcessCount: workers.length,
		backendRssBytes: overrides.backendRss,
		totalSpawned: overrides.totalSpawned ?? 0,
		executions: { total: 0, active: 0, maxActive: 0 },
		workerRssBytes: workers.reduce((total, worker) => total + worker.rssBytes, 0),
		deno: {
			userCpuTicks: null,
			systemCpuTicks: null,
			rssBytes: overrides.denoRss,
			processCount: workers.length,
		},
		replays: {
			totalFailed: 0,
			totalStarted: 0,
			totalCompleted: 0,
			totalJournalBytes: overrides.journalBytes ?? 0,
		},
		workers: workers.map((worker) => ({
			pid: worker.pid,
			userCpuTicks: null,
			systemCpuTicks: null,
			startTimeTicks: null,
			rssBytes: worker.rssBytes,
		})),
		backend: {
			systemCpuMicros: 0,
			arrayBuffersBytes: 0,
			rssBytes: overrides.backendRss,
			heapTotalBytes: overrides.backendRss,
			heapUsedBytes: overrides.backendRss / 2,
			externalBytes: overrides.backendRss / 4,
			userCpuMicros: overrides.backendUserCpuMicros ?? 0,
		},
		cgroup: {
			pidsCurrent: 10,
			memoryMaxBytes: null,
			memoryPeakBytes: 1_000,
			cpu: { userUsec: 0, usageUsec: 0, systemUsec: 0 },
			memoryCurrentBytes: overrides.cgroupMemoryCurrent ?? 500,
			events: { low: 0, max: 0, oom: 0, high: 0, oomKill: overrides.oomKill ?? 0 },
		},
	};
};

const preScenarioSample = sample({ denoRss: 0, timestampMs: 0, backendRss: 100 });

describe("summarizeScenario", () => {
	it("reports peaks, per-worker peaks and counter deltas across the scenario window", () => {
		const statistics = summarizeScenario({
			preScenarioSample,
			terminalAtMs: 400,
			samples: [
				sample({
					denoRss: 300,
					backendRss: 150,
					totalSpawned: 1,
					timestampMs: 100,
					journalBytes: 40,
					workers: [{ pid: 1, rssBytes: 300 }],
				}),
				sample({
					denoRss: 900,
					backendRss: 400,
					totalSpawned: 2,
					timestampMs: 200,
					journalBytes: 90,
					workers: [
						{ pid: 1, rssBytes: 500 },
						{ pid: 2, rssBytes: 400 },
					],
				}),
				sample({
					denoRss: 450,
					backendRss: 250,
					totalSpawned: 2,
					timestampMs: 300,
					journalBytes: 90,
					workers: [{ pid: 2, rssBytes: 450 }],
				}),
			],
		});

		expect(statistics.sampleCount).toBe(3);
		expect(statistics.backendRssBytes.peak).toBe(400);
		expect(statistics.denoAggregateRssBytes.peak).toBe(900);
		expect(statistics.peakWorkerCount).toBe(2);
		expect(statistics.workerPeakRssBytes).toEqual([500, 450]);
		expect(statistics.backendHeapUsedPeakBytes).toBe(200);
		expect(statistics.counterDeltas.totalSpawned).toBe(2);
		expect(statistics.counterDeltas.replayJournalBytes).toBe(90);
	});

	it("reports recovery time once Bun RSS returns within ten percent of the pre-scenario value", () => {
		const statistics = summarizeScenario({
			preScenarioSample,
			terminalAtMs: 200,
			samples: [
				sample({
					denoRss: 0,
					backendRss: 500,
					timestampMs: 100,
					workers: [{ pid: 1, rssBytes: 10 }],
				}),
				sample({ denoRss: 0, backendRss: 400, timestampMs: 300 }),
				sample({ denoRss: 0, backendRss: 105, timestampMs: 900 }),
			],
		});

		expect(statistics.recovery.thresholdBytes).toBeCloseTo(110);
		expect(statistics.recovery.recoveredAfterMs).toBe(700);
		expect(statistics.recovery.workersDrainedAfterMs).toBe(100);
	});

	it("reports null recovery when Bun RSS stays high past the five minute window", () => {
		const statistics = summarizeScenario({
			terminalAtMs: 0,
			preScenarioSample,
			samples: [
				sample({ denoRss: 0, backendRss: 900, timestampMs: 1_000 }),
				sample({ denoRss: 0, backendRss: 100, timestampMs: RECOVERY_WINDOW_MS + 1_000 }),
			],
		});

		expect(statistics.recovery.recoveredAfterMs).toBeNull();
	});

	it("derives cgroup event deltas and CPU deltas from the scenario endpoints", () => {
		const statistics = summarizeScenario({
			preScenarioSample,
			terminalAtMs: 100,
			samples: [
				sample({
					denoRss: 0,
					oomKill: 1,
					backendRss: 200,
					timestampMs: 100,
					cgroupMemoryCurrent: 4_000,
					backendUserCpuMicros: 7_500,
				}),
			],
		});

		expect(statistics.cgroup?.eventDeltas.oomKill).toBe(1);
		expect(statistics.cgroup?.memoryCurrentPeakBytes).toBe(4_000);
		expect(statistics.cpuDeltas.backendUserMicros).toBe(7_500);
	});
});
