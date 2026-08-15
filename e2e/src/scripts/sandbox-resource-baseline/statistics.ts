import { Schema } from "effect";

import { percentile, type RuntimeSample } from "~/support/benchmark-workload";

export const RECOVERY_TOLERANCE_RATIO = 0.1;
export const RECOVERY_WINDOW_MS = 300_000;

const Distribution = Schema.Struct({ p50: Schema.Finite, p95: Schema.Finite, peak: Schema.Finite });

const OptionalDelta = Schema.NullOr(Schema.Finite);

export const ScenarioStatistics = Schema.Struct({
	sampleCount: Schema.Int,
	peakWorkerCount: Schema.Int,
	workerRssBytes: Distribution,
	backendRssBytes: Distribution,
	denoAggregateRssBytes: Distribution,
	backendHeapUsedPeakBytes: Schema.Finite,
	backendExternalPeakBytes: Schema.Finite,
	/** Per-worker peak RSS, ranked descending; workers are anonymous so no PID reaches artifacts. */
	workerPeakRssBytes: Schema.Array(Schema.Finite),
	cpuDeltas: Schema.Struct({
		denoUserTicks: OptionalDelta,
		cgroupUserUsec: OptionalDelta,
		denoSystemTicks: OptionalDelta,
		cgroupUsageUsec: OptionalDelta,
		cgroupSystemUsec: OptionalDelta,
		backendUserMicros: OptionalDelta,
		backendSystemMicros: OptionalDelta,
	}),
	cgroup: Schema.NullOr(
		Schema.Struct({
			memoryPeakBytes: OptionalDelta,
			memoryCurrentPeakBytes: OptionalDelta,
			eventDeltas: Schema.Struct({
				low: Schema.Finite,
				max: Schema.Finite,
				oom: Schema.Finite,
				high: Schema.Finite,
				oomKill: Schema.Finite,
			}),
		}),
	),
	counterDeltas: Schema.Struct({
		totalSpawned: Schema.Finite,
		replaysFailed: Schema.Finite,
		totalCompleted: Schema.Finite,
		replaysStarted: Schema.Finite,
		executionsTotal: Schema.Finite,
		replaysCompleted: Schema.Finite,
		replayJournalBytes: Schema.Finite,
		executionsMaxActive: Schema.Finite,
	}),
	recovery: Schema.Struct({
		thresholdBytes: Schema.Finite,
		preScenarioBackendRssBytes: Schema.Finite,
		/** Null when Bun RSS did not return within 10% of its pre-scenario value in five minutes. */
		recoveredAfterMs: Schema.NullOr(Schema.Finite),
		workersDrainedAfterMs: Schema.NullOr(Schema.Finite),
	}),
});
export type ScenarioStatistics = typeof ScenarioStatistics.Type;

const distribution = (values: ReadonlyArray<number>) => ({
	p50: percentile(values, 0.5),
	p95: percentile(values, 0.95),
	peak: values.length === 0 ? 0 : Math.max(...values),
});

const delta = (before: number | null, after: number | null) =>
	before === null || after === null ? null : after - before;

const maxOrNull = (values: ReadonlyArray<number | null>) => {
	const present = values.filter((value): value is number => value !== null);
	return present.length === 0 ? null : Math.max(...present);
};

const firstTimeAfter = (
	samples: ReadonlyArray<RuntimeSample>,
	fromMs: number,
	predicate: (sample: RuntimeSample) => boolean,
) => {
	const match = samples.find(
		(sample) =>
			sample.timestampMs >= fromMs &&
			sample.timestampMs - fromMs <= RECOVERY_WINDOW_MS &&
			predicate(sample),
	);
	return match === undefined ? null : match.timestampMs - fromMs;
};

export const summarizeScenario = (input: {
	readonly terminalAtMs: number;
	readonly samples: ReadonlyArray<RuntimeSample>;
	readonly preScenarioSample: RuntimeSample;
}): ScenarioStatistics => {
	const { samples, terminalAtMs, preScenarioSample } = input;
	const last = samples.at(-1) ?? preScenarioSample;
	const workerPeaks = new Map<number, number>();
	for (const sample of samples) {
		for (const worker of sample.workers) {
			workerPeaks.set(worker.pid, Math.max(workerPeaks.get(worker.pid) ?? 0, worker.rssBytes));
		}
	}
	const thresholdBytes = preScenarioSample.backend.rssBytes * (1 + RECOVERY_TOLERANCE_RATIO);
	return {
		sampleCount: samples.length,
		backendRssBytes: distribution(samples.map(({ backend }) => backend.rssBytes)),
		denoAggregateRssBytes: distribution(samples.map(({ deno }) => deno.rssBytes)),
		peakWorkerCount: Math.max(0, ...samples.map(({ workers }) => workers.length)),
		workerRssBytes: distribution(samples.map(({ workerRssBytes }) => workerRssBytes)),
		workerPeakRssBytes: [...workerPeaks.values()].sort((left, right) => right - left),
		backendHeapUsedPeakBytes: Math.max(0, ...samples.map(({ backend }) => backend.heapUsedBytes)),
		backendExternalPeakBytes: Math.max(0, ...samples.map(({ backend }) => backend.externalBytes)),
		recovery: {
			thresholdBytes,
			preScenarioBackendRssBytes: preScenarioSample.backend.rssBytes,
			recoveredAfterMs: firstTimeAfter(
				samples,
				terminalAtMs,
				(sample) => sample.backend.rssBytes <= thresholdBytes,
			),
			workersDrainedAfterMs: firstTimeAfter(
				samples,
				terminalAtMs,
				(sample) => sample.workers.length === 0 && sample.activeProcessCount === 0,
			),
		},
		cgroup:
			last.cgroup === null
				? null
				: {
						memoryPeakBytes: last.cgroup.memoryPeakBytes,
						memoryCurrentPeakBytes: maxOrNull(
							samples.map((sample) => sample.cgroup?.memoryCurrentBytes ?? null),
						),
						eventDeltas: {
							low: last.cgroup.events.low - (preScenarioSample.cgroup?.events.low ?? 0),
							max: last.cgroup.events.max - (preScenarioSample.cgroup?.events.max ?? 0),
							oom: last.cgroup.events.oom - (preScenarioSample.cgroup?.events.oom ?? 0),
							high: last.cgroup.events.high - (preScenarioSample.cgroup?.events.high ?? 0),
							oomKill: last.cgroup.events.oomKill - (preScenarioSample.cgroup?.events.oomKill ?? 0),
						},
					},
		counterDeltas: {
			totalSpawned: last.totalSpawned - preScenarioSample.totalSpawned,
			totalCompleted: last.totalCompleted - preScenarioSample.totalCompleted,
			executionsTotal: last.executions.total - preScenarioSample.executions.total,
			replaysFailed: last.replays.totalFailed - preScenarioSample.replays.totalFailed,
			replaysStarted: last.replays.totalStarted - preScenarioSample.replays.totalStarted,
			executionsMaxActive: last.executions.maxActive - preScenarioSample.executions.maxActive,
			replaysCompleted: last.replays.totalCompleted - preScenarioSample.replays.totalCompleted,
			replayJournalBytes:
				last.replays.totalJournalBytes - preScenarioSample.replays.totalJournalBytes,
		},
		cpuDeltas: {
			denoUserTicks: delta(preScenarioSample.deno.userCpuTicks, last.deno.userCpuTicks),
			denoSystemTicks: delta(preScenarioSample.deno.systemCpuTicks, last.deno.systemCpuTicks),
			backendUserMicros: delta(preScenarioSample.backend.userCpuMicros, last.backend.userCpuMicros),
			backendSystemMicros: delta(
				preScenarioSample.backend.systemCpuMicros,
				last.backend.systemCpuMicros,
			),
			cgroupUserUsec: delta(
				preScenarioSample.cgroup?.cpu.userUsec ?? null,
				last.cgroup?.cpu.userUsec ?? null,
			),
			cgroupUsageUsec: delta(
				preScenarioSample.cgroup?.cpu.usageUsec ?? null,
				last.cgroup?.cpu.usageUsec ?? null,
			),
			cgroupSystemUsec: delta(
				preScenarioSample.cgroup?.cpu.systemUsec ?? null,
				last.cgroup?.cpu.systemUsec ?? null,
			),
		},
	};
};
