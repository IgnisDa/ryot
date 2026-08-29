import { describe, expect, it } from "~/support/effect-test";

import type { ScenarioRequest } from "./artifacts";
import type { HostSampleLine } from "./host/samples";
import {
	type AppRecord,
	attachRequestTimings,
	executionTimings,
	hostMetrics,
	repetitionMetrics,
	requestMetrics,
	workerLifecycle,
} from "./statistics";

const MiB = 1_048_576;

const record = (t: number, overrides: Partial<AppRecord> = {}): AppRecord => ({
	t,
	denoRss: 0,
	workers: [],
	bunHwm: null,
	totalSpawned: 0,
	cgroupPeak: null,
	cgroupOomKill: 0,
	replaysFailed: 0,
	bunUserMicros: 0,
	bunRss: 400 * MiB,
	totalCompleted: 0,
	replaysStarted: 0,
	bunSystemMicros: 0,
	executionsTotal: 0,
	durableRequests: 0,
	replaysCompleted: 0,
	activeExecutions: 0,
	bunHeapUsed: 80 * MiB,
	bunExternal: 10 * MiB,
	replayJournalBytes: 0,
	bunHeapTotal: 120 * MiB,
	cgroupCurrent: 600 * MiB,
	bunArrayBuffers: 1 * MiB,
	executingImportBodies: 0,
	...overrides,
});

const request = (
	index: number,
	latencyMs: number,
	outcome: ScenarioRequest["outcome"] = "completed",
): ScenarioRequest => ({
	index,
	outcome,
	wave: 1,
	latencyMs,
	attempts: null,
	startedAtMs: 0,
	failureCode: null,
	queueWaitMs: null,
	executionMs: null,
	failureStage: null,
	identityDigest: null,
	terminalAtMs: latencyMs,
	responseByteLength: null,
});

const hostLine = (
	startedMs: number,
	overrides: {
		ryotId?: string;
		ryotCpuUsec?: number;
		peakSinceReset?: number | null;
		memAvailable?: number;
		majfault?: number;
	} = {},
): HostSampleLine => {
	const container = (containerId: string, usageUsec: number) => ({
		containerId,
		ioStat: null,
		pidsCurrent: 1,
		memoryStat: null,
		memoryEvents: null,
		memoryPeakBytes: 900 * MiB,
		memoryCurrentBytes: 500 * MiB,
		peakSinceResetBytes: overrides.peakSinceReset ?? null,
		cpuStat: {
			usageUsec,
			userUsec: null,
			systemUsec: null,
			nrThrottled: null,
			throttledUsec: null,
		},
	});
	return {
		startedMs,
		disk: null,
		device: "sda",
		durationMs: 1,
		kind: "sample",
		missedSlotsBefore: 0,
		timestampMs: startedMs,
		scheduledMs: startedMs,
		sampler: { rssBytes: 40 * MiB },
		pressure: { io: null, cpu: null, memory: null },
		containers: {
			otel: null,
			redis: null,
			postgres: null,
			ryot: container(overrides.ryotId ?? "ryot-1", overrides.ryotCpuUsec ?? 0),
		},
		vmstat: {
			pgscan: 0,
			pgfault: 0,
			oomKill: 0,
			pgsteal: 0,
			pgscanDirect: 0,
			pgscanKswapd: 0,
			workingsetRefaultAnon: 0,
			workingsetRefaultFile: 0,
			pgmajfault: overrides.majfault ?? 0,
		},
		meminfo: {
			dirtyBytes: 0,
			cachedBytes: 0,
			swapFreeBytes: 0,
			memTotalBytes: 0,
			writebackBytes: 0,
			swapTotalBytes: 0,
			sReclaimableBytes: 0,
			memAvailableBytes: overrides.memAvailable ?? 3_000 * MiB,
		},
	};
};

describe("repetitionMetrics", () => {
	it("reports pre, peak, post and baseline-normalized deltas for the scenario window", () => {
		const pre = record(0, { denoRss: 0 });
		const metrics = repetitionMetrics({
			pre,
			host: [],
			health: [],
			requests: [],
			pressure: [],
			completedWorkers: [],
			window: { terminalAtMs: 300, submittedAtMs: 100, completedAtMs: 500 },
			records: [
				record(50, { bunRss: 999 * MiB }),
				record(100, {
					bunRss: 500 * MiB,
					denoRss: 150 * MiB,
					workers: [{ pid: 1, rss: 150 * MiB }],
				}),
				record(200, {
					bunRss: 650 * MiB,
					denoRss: 300 * MiB,
					workers: [
						{ pid: 1, rss: 170 * MiB },
						{ pid: 2, rss: 130 * MiB },
					],
				}),
				record(500, { bunRss: 430 * MiB }),
			],
		});

		expect(metrics["pre.bunRssBytes"]).toBe(400 * MiB);
		expect(metrics["peak.bunRssBytes"]).toBe(650 * MiB);
		expect(metrics["peakDelta.bunRssBytes"]).toBe(250 * MiB);
		expect(metrics["peakDelta.denoAggregateRssBytes"]).toBe(300 * MiB);
		expect(metrics["post.bunRssBytes"]).toBe(430 * MiB);
		expect(metrics["postDelta.bunRssBytes"]).toBe(30 * MiB);
		expect(metrics["peak.workerCount"]).toBe(2);
		expect(metrics["recovery.bunRssRecoveredAfterMs"]).toBe(200);
		expect(metrics["recovery.workersDrainedAfterMs"]).toBe(200);
	});
});

describe("workerLifecycle", () => {
	it("counts workers from lifecycle counters and reports unread lifetime peaks as unobserved", () => {
		const lifecycle = workerLifecycle({
			pre: record(0, { totalSpawned: 4, totalCompleted: 4 }),
			last: record(20, { totalSpawned: 7, totalCompleted: 7 }),
			records: [record(10, { workers: [{ pid: 7, rss: 120 * MiB }] })],
			completedWorkers: [
				{
					sequence: 1,
					spawnedAtMs: 0,
					releasedAtMs: 5,
					executionKey: "a",
					lifetimePeakRssBytes: 140 * MiB,
				},
				{
					sequence: 2,
					spawnedAtMs: 5,
					releasedAtMs: 8,
					executionKey: "a",
					lifetimePeakRssBytes: null,
				},
				{
					sequence: 3,
					spawnedAtMs: 8,
					releasedAtMs: 20,
					executionKey: "b",
					lifetimePeakRssBytes: 90 * MiB,
				},
			],
		});

		expect(lifecycle).toEqual({
			spawned: 3,
			completed: 3,
			sampledWorkerCount: 1,
			lifetimePeakUnobserved: 1,
			sampledPeakRssBytes: [120 * MiB],
			lifetimePeakRssBytes: [140 * MiB, 90 * MiB],
		});
	});
});

describe("executionTimings", () => {
	it("measures queue wait to the first attempt and sums every replay attempt", () => {
		const timings = executionTimings(
			[
				{
					sequence: 1,
					spawnedAtMs: 1_500,
					releasedAtMs: 1_900,
					executionKey: "exec-1",
					lifetimePeakRssBytes: null,
				},
				{
					sequence: 2,
					spawnedAtMs: 2_000,
					releasedAtMs: 2_300,
					executionKey: "exec-1",
					lifetimePeakRssBytes: null,
				},
				{
					sequence: 3,
					spawnedAtMs: 1_100,
					releasedAtMs: 1_200,
					executionKey: "other",
					lifetimePeakRssBytes: null,
				},
			],
			[
				{ submittedAtMs: 1_000, executionKey: "exec-1" },
				{ submittedAtMs: 1_000, executionKey: "missing" },
			],
		);

		expect(timings.get("exec-1")).toEqual({ attempts: 2, queueWaitMs: 500, executionMs: 700 });
		expect(timings.has("missing")).toBe(false);
	});
});

describe("attachRequestTimings", () => {
	const keyed = (
		executionKey: string | null,
		index: number,
	): ScenarioRequest & { readonly executionKey: string | null } => ({
		...request(index, 2_000),
		executionKey,
	});
	const workers = new Map([["exec-1", { attempts: 2, queueWaitMs: 500, executionMs: 700 }]]);
	const phases = new Map([["import-a", { attempts: 4, queueWaitMs: 100, executionMs: 1_400 }]]);

	it("joins import submissions to phase timings and leaves unmatched keys null", () => {
		const attached = attachRequestTimings(
			[keyed("import-a", 0), keyed("exec-1", 1), keyed("unknown", 2), keyed(null, 3)],
			{ phases, workers, usePhaseTimings: true },
		);

		expect(attached[0]).toMatchObject({ attempts: 4, queueWaitMs: 100, executionMs: 1_400 });
		expect(attached[1]).toMatchObject({ attempts: null, queueWaitMs: null, executionMs: null });
		expect(attached[2]).toMatchObject({ attempts: null, queueWaitMs: null, executionMs: null });
		expect(attached[3]).toMatchObject({ attempts: null, queueWaitMs: null, executionMs: null });
	});

	it("joins direct submissions to worker timings when phase timings are off", () => {
		const attached = attachRequestTimings([keyed("import-a", 0), keyed("exec-1", 1)], {
			phases,
			workers,
			usePhaseTimings: false,
		});

		expect(attached[0]).toMatchObject({ attempts: null, queueWaitMs: null, executionMs: null });
		expect(attached[1]).toMatchObject({ attempts: 2, queueWaitMs: 500, executionMs: 700 });
	});
});

describe("requestMetrics", () => {
	it("derives throughput from completed requests over the submission-to-last-terminal window", () => {
		const metrics = requestMetrics(
			[request(0, 30_000), request(1, 60_000), request(2, 45_000, "failed")],
			{ submittedAtMs: 0, terminalAtMs: 60_000, completedAtMs: 90_000 },
		);

		expect(metrics["requests.throughputPerMinute"]).toBe(2);
		expect(metrics["requests.failed"]).toBe(1);
		expect(metrics["requests.latencyMs.p50"]).toBe(45_000);
	});

	it("derives non-null queue and execution spreads once requests carry the split", () => {
		const metrics = requestMetrics(
			[{ ...request(0, 2_000), attempts: 4, queueWaitMs: 100, executionMs: 1_400 }],
			{ submittedAtMs: 0, terminalAtMs: 2_000, completedAtMs: 3_000 },
		);

		expect(metrics["requests.executionMs.p50"]).toBe(1_400);
		expect(metrics["requests.queueWaitMs.p50"]).toBe(100);
		expect(
			(metrics["requests.queueWaitMs.p50"] ?? 0) + (metrics["requests.executionMs.p50"] ?? 0),
		).toBeLessThanOrEqual(2_000);
	});
});

describe("hostMetrics", () => {
	it("drops container counter deltas across a restart and keeps host counter deltas", () => {
		const restarted = hostMetrics([
			hostLine(0, { majfault: 10, ryotCpuUsec: 5_000_000 }),
			hostLine(1_000, {
				majfault: 25,
				ryotId: "ryot-2",
				ryotCpuUsec: 100_000,
				memAvailable: 2_000 * MiB,
			}),
		]);
		const steady = hostMetrics([
			hostLine(0, { ryotCpuUsec: 1_000_000 }),
			hostLine(1_000, { ryotCpuUsec: 3_000_000 }),
		]);

		expect(restarted["ryot.cgroupCpuMs"]).toBeNull();
		expect(restarted["host.pgmajfaultDelta"]).toBe(15);
		expect(restarted["host.memAvailableMinBytes"]).toBe(2_000 * MiB);
		expect(steady["ryot.cgroupCpuMs"]).toBe(2_000);
	});

	it("reports the per-scenario cgroup peak only from the reset descriptor", () => {
		expect(hostMetrics([hostLine(0)])["ryot.cgroupScenarioPeakBytes"]).toBeNull();
		expect(
			hostMetrics([
				hostLine(0, { peakSinceReset: 700 * MiB }),
				hostLine(1_000, { peakSinceReset: 800 * MiB }),
			])["ryot.cgroupScenarioPeakBytes"],
		).toBe(800 * MiB);
	});
});
