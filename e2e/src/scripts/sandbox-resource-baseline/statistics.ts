import type { AppPoint, HostPoint, MetricValues, ScenarioRequest } from "./artifacts";
import type { HostSampleLine } from "./host/samples";

export const RECOVERY_TOLERANCE_RATIO = 0.1;

export type AppRecord = {
	readonly t: number;
	readonly bunRss: number;
	readonly bunHeapUsed: number;
	readonly bunHeapTotal: number;
	readonly bunExternal: number;
	readonly bunArrayBuffers: number;
	readonly bunUserMicros: number | null;
	readonly bunSystemMicros: number | null;
	readonly bunHwm: number | null;
	readonly denoRss: number;
	readonly workers: ReadonlyArray<{ readonly pid: number; readonly rss: number }>;
	readonly cgroupCurrent: number | null;
	readonly cgroupPeak: number | null;
	readonly cgroupOomKill: number | null;
	readonly activeExecutions: number;
	readonly executingImportBodies: number;
	readonly totalSpawned: number;
	readonly totalCompleted: number;
	readonly executionsTotal: number;
	readonly replaysStarted: number;
	readonly replaysCompleted: number;
	readonly replaysFailed: number;
	readonly replayJournalBytes: number;
	readonly durableRequests: number;
};

export type CompletedWorkerRecord = {
	readonly sequence: number;
	readonly spawnedAtMs: number;
	readonly releasedAtMs: number;
	readonly executionKey: string | null;
	readonly lifetimePeakRssBytes: number | null;
};

export type HealthPing = { readonly t: number; readonly latencyMs: number; readonly ok: boolean };

export type PressurePoint = {
	readonly t: number;
	readonly deadlocks: number;
	readonly totalConnections: number;
	readonly activeConnections: number;
	readonly lockWaitingConnections: number;
};

export type RepetitionWindow = {
	readonly submittedAtMs: number;
	readonly terminalAtMs: number;
	readonly completedAtMs: number;
};

const nearestRank = (values: ReadonlyArray<number>, ratio: number) => {
	if (values.length === 0) {
		return null;
	}
	const sorted = [...values].sort((left, right) => left - right);
	return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)] ?? null;
};

export const median = (values: ReadonlyArray<number>) => nearestRank(values, 0.5);
export const p95 = (values: ReadonlyArray<number>) => nearestRank(values, 0.95);
const maximum = (values: ReadonlyArray<number>) =>
	values.length === 0 ? null : Math.max(...values);
const minimum = (values: ReadonlyArray<number>) =>
	values.length === 0 ? null : Math.min(...values);
const present = (values: ReadonlyArray<number | null | undefined>) =>
	values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
const difference = (after: number | null | undefined, before: number | null | undefined) =>
	after === null || after === undefined || before === null || before === undefined
		? null
		: after - before;

const spreadMetrics = (prefix: string, values: ReadonlyArray<number>): MetricValues => ({
	[`${prefix}.p95`]: p95(values),
	[`${prefix}.p50`]: median(values),
	[`${prefix}.max`]: maximum(values),
});

const within = <T extends { readonly t: number }>(
	records: ReadonlyArray<T>,
	fromMs: number,
	toMs: number,
) => records.filter(({ t }) => t >= fromMs && t <= toMs);

const MEMORY_FIELDS = [
	["bunRssBytes", (record: AppRecord) => record.bunRss],
	["bunHeapUsedBytes", (record: AppRecord) => record.bunHeapUsed],
	["bunHeapTotalBytes", (record: AppRecord) => record.bunHeapTotal],
	["bunExternalBytes", (record: AppRecord) => record.bunExternal],
	["bunArrayBuffersBytes", (record: AppRecord) => record.bunArrayBuffers],
	["denoAggregateRssBytes", (record: AppRecord) => record.denoRss],
	["cgroupMemoryBytes", (record: AppRecord) => record.cgroupCurrent],
] as const;

const memoryValues = (prefix: string, record: AppRecord | undefined): MetricValues =>
	Object.fromEntries(
		MEMORY_FIELDS.map(([name, read]) => [
			`${prefix}.${name}`,
			record === undefined ? null : read(record),
		]),
	);

const peakValues = (records: ReadonlyArray<AppRecord>): MetricValues => ({
	...Object.fromEntries(
		MEMORY_FIELDS.map(([name, read]) => [`peak.${name}`, maximum(present(records.map(read)))]),
	),
	"peak.workerCount": maximum(records.map(({ workers }) => workers.length)),
});

const deltaValues = (
	prefix: string,
	values: MetricValues,
	source: string,
	pre: MetricValues,
): MetricValues =>
	Object.fromEntries(
		MEMORY_FIELDS.map(([name]) => [
			`${prefix}.${name}`,
			difference(values[`${source}.${name}`], pre[`pre.${name}`]),
		]),
	);

const firstAfter = <T extends { readonly t: number }>(
	records: ReadonlyArray<T>,
	fromMs: number,
	predicate: (record: T) => boolean,
) => {
	const match = records.find((record) => record.t >= fromMs && predicate(record));
	return match === undefined ? null : match.t - fromMs;
};

/**
 * Per-process lifetime peaks come from `VmHWM` read at release, so a worker that started and exited
 * between two snapshots still has an observed peak; a missing read is counted as unobserved.
 */
export const workerLifecycle = (input: {
	readonly records: ReadonlyArray<AppRecord>;
	readonly completedWorkers: ReadonlyArray<CompletedWorkerRecord>;
	readonly pre: AppRecord;
	readonly last: AppRecord;
}) => {
	const sampledPeaks = new Map<number, number>();
	for (const record of input.records) {
		for (const worker of record.workers) {
			sampledPeaks.set(worker.pid, Math.max(sampledPeaks.get(worker.pid) ?? 0, worker.rss));
		}
	}
	const lifetimePeaks = present(
		input.completedWorkers.map((worker) => worker.lifetimePeakRssBytes),
	);
	return {
		sampledWorkerCount: sampledPeaks.size,
		spawned: input.last.totalSpawned - input.pre.totalSpawned,
		completed: input.last.totalCompleted - input.pre.totalCompleted,
		lifetimePeakRssBytes: [...lifetimePeaks].sort((left, right) => right - left),
		lifetimePeakUnobserved: input.completedWorkers.length - lifetimePeaks.length,
		sampledPeakRssBytes: [...sampledPeaks.values()].sort((left, right) => right - left),
	};
};

type ExecutionTiming = {
	readonly queueWaitMs: number;
	readonly executionMs: number;
	readonly attempts: number;
};

/** Queue wait is submission to the first Deno attempt; execution time sums every attempt's lifetime. */
export const executionTimings = (
	completedWorkers: ReadonlyArray<CompletedWorkerRecord>,
	submissions: ReadonlyArray<{ readonly executionKey: string; readonly submittedAtMs: number }>,
) => {
	const timings = new Map<string, ExecutionTiming>();
	for (const submission of submissions) {
		const attempts = completedWorkers.filter(
			(worker) => worker.executionKey === submission.executionKey,
		);
		if (attempts.length === 0) {
			continue;
		}
		timings.set(submission.executionKey, {
			attempts: attempts.length,
			queueWaitMs:
				Math.min(...attempts.map(({ spawnedAtMs }) => spawnedAtMs)) - submission.submittedAtMs,
			executionMs: attempts.reduce(
				(total, worker) => total + (worker.releasedAtMs - worker.spawnedAtMs),
				0,
			),
		});
	}
	return timings;
};

const pressureAvg10 = (
	line: HostSampleLine,
	resource: "cpu" | "memory" | "io",
	kind: "some" | "full",
) => line.pressure[resource]?.[kind]?.avg10 ?? null;

const pressureTotalMs = (
	line: HostSampleLine | undefined,
	resource: "cpu" | "memory" | "io",
	kind: "some" | "full",
) => {
	const total = line?.pressure[resource]?.[kind]?.totalUs;
	return total === undefined || total === null ? null : total / 1_000;
};

const containerCpuMs = (
	line: HostSampleLine | undefined,
	role: "ryot" | "postgres" | "redis" | "otel",
) => {
	const usage = line?.containers[role]?.cpuStat?.usageUsec;
	return usage === undefined || usage === null ? null : usage / 1_000;
};

const sameContainer = (
	first: HostSampleLine | undefined,
	last: HostSampleLine | undefined,
	role: "ryot" | "postgres" | "redis" | "otel",
) => {
	const before = first?.containers[role]?.containerId;
	return before !== undefined && before === last?.containers[role]?.containerId;
};

/** Counter deltas are dropped when a container restarted inside the window, since its cgroup reset. */
export const hostMetrics = (lines: ReadonlyArray<HostSampleLine>): MetricValues => {
	const first = lines[0];
	const last = lines.at(-1);
	const roleDelta = (
		role: "ryot" | "postgres" | "redis" | "otel",
		read: (line: HostSampleLine | undefined) => number | null,
	) => (sameContainer(first, last, role) ? difference(read(last), read(first)) : null);
	const roleMaximum = (role: "ryot" | "postgres" | "redis" | "otel") =>
		maximum(present(lines.map((line) => line.containers[role]?.memoryCurrentBytes)));
	return {
		"otel.sampledPeakBytes": roleMaximum("otel"),
		"redis.sampledPeakBytes": roleMaximum("redis"),
		"ryot.cgroupSampledPeakBytes": roleMaximum("ryot"),
		"postgres.sampledPeakBytes": roleMaximum("postgres"),
		"host.pgscanDelta": difference(last?.vmstat?.pgscan, first?.vmstat?.pgscan),
		"ryot.cgroupCpuMs": roleDelta("ryot", (line) => containerCpuMs(line, "ryot")),
		"otel.cgroupCpuMs": roleDelta("otel", (line) => containerCpuMs(line, "otel")),
		"host.pgstealDelta": difference(last?.vmstat?.pgsteal, first?.vmstat?.pgsteal),
		"host.oomKillDelta": difference(last?.vmstat?.oomKill, first?.vmstat?.oomKill),
		"ryot.cgroupLifetimePeakBytes": last?.containers.ryot?.memoryPeakBytes ?? null,
		"redis.cgroupCpuMs": roleDelta("redis", (line) => containerCpuMs(line, "redis")),
		"host.samplerRssBytes": maximum(present(lines.map((line) => line.sampler.rssBytes))),
		"host.pgmajfaultDelta": difference(last?.vmstat?.pgmajfault, first?.vmstat?.pgmajfault),
		"postgres.cgroupCpuMs": roleDelta("postgres", (line) => containerCpuMs(line, "postgres")),
		"host.diskReadsDelta": difference(last?.disk?.readsCompleted, first?.disk?.readsCompleted),
		"host.diskSectorsReadDelta": difference(last?.disk?.sectorsRead, first?.disk?.sectorsRead),
		"host.ioPsiSomeAvg10Max": maximum(
			present(lines.map((line) => pressureAvg10(line, "io", "some"))),
		),
		"host.memAvailableMinBytes": minimum(
			present(lines.map((line) => line.meminfo?.memAvailableBytes)),
		),
		"host.cpuPsiSomeAvg10Max": maximum(
			present(lines.map((line) => pressureAvg10(line, "cpu", "some"))),
		),
		"host.diskSectorsWrittenDelta": difference(
			last?.disk?.sectorsWritten,
			first?.disk?.sectorsWritten,
		),
		"host.memoryPsiSomeAvg10Max": maximum(
			present(lines.map((line) => pressureAvg10(line, "memory", "some"))),
		),
		"host.memoryPsiFullAvg10Max": maximum(
			present(lines.map((line) => pressureAvg10(line, "memory", "full"))),
		),
		"ryot.cgroupPgscanDelta": roleDelta(
			"ryot",
			(line) => line?.containers.ryot?.memoryStat?.pgscan ?? null,
		),
		"ryot.cgroupIoReadBytesDelta": roleDelta(
			"ryot",
			(line) => line?.containers.ryot?.ioStat?.rbytes ?? null,
		),
		"ryot.cgroupOomKillDelta": roleDelta(
			"ryot",
			(line) => line?.containers.ryot?.memoryEvents?.oomKill ?? null,
		),
		"ryot.cgroupScenarioPeakBytes": maximum(
			present(lines.map((line) => line.containers.ryot?.peakSinceResetBytes)),
		),
		"host.ioPsiSomeStallMs": difference(
			pressureTotalMs(last, "io", "some"),
			pressureTotalMs(first, "io", "some"),
		),
		"ryot.cgroupPgmajfaultDelta": roleDelta(
			"ryot",
			(line) => line?.containers.ryot?.memoryStat?.pgmajfault ?? null,
		),
		"host.cpuPsiSomeStallMs": difference(
			pressureTotalMs(last, "cpu", "some"),
			pressureTotalMs(first, "cpu", "some"),
		),
		"host.memoryPsiFullStallMs": difference(
			pressureTotalMs(last, "memory", "full"),
			pressureTotalMs(first, "memory", "full"),
		),
	};
};

export const requestMetrics = (
	requests: ReadonlyArray<ScenarioRequest>,
	window: RepetitionWindow,
): MetricValues => {
	const completed = requests.filter(({ outcome }) => outcome === "completed");
	const lastTerminal = maximum(requests.map(({ terminalAtMs }) => terminalAtMs));
	const loadDurationMs = lastTerminal === null ? null : lastTerminal - window.submittedAtMs;
	return {
		"requests.count": requests.length,
		"requests.completed": completed.length,
		"requests.loadDurationMs": loadDurationMs,
		"requests.failed": requests.length - completed.length,
		"requests.throughputPerMinute":
			loadDurationMs === null || loadDurationMs <= 0
				? null
				: completed.length / (loadDurationMs / 60_000),
		...spreadMetrics(
			"requests.latencyMs",
			requests.map(({ latencyMs }) => latencyMs),
		),
		...spreadMetrics(
			"requests.queueWaitMs",
			present(requests.map(({ queueWaitMs }) => queueWaitMs)),
		),
		...spreadMetrics(
			"requests.executionMs",
			present(requests.map(({ executionMs }) => executionMs)),
		),
	};
};

export const repetitionMetrics = (input: {
	readonly pre: AppRecord;
	readonly records: ReadonlyArray<AppRecord>;
	readonly window: RepetitionWindow;
	readonly requests: ReadonlyArray<ScenarioRequest>;
	readonly completedWorkers: ReadonlyArray<CompletedWorkerRecord>;
	readonly health: ReadonlyArray<HealthPing>;
	readonly pressure: ReadonlyArray<PressurePoint>;
	readonly host: ReadonlyArray<HostSampleLine>;
}): MetricValues => {
	const { pre, window } = input;
	const scenario = within(input.records, window.submittedAtMs, window.completedAtMs);
	const load = within(input.records, window.submittedAtMs, window.terminalAtMs);
	const last = scenario.at(-1) ?? pre;
	const preValues = memoryValues("pre", pre);
	const peaks = peakValues(scenario);
	const postValues = memoryValues("post", last);
	const lifecycle = workerLifecycle({
		pre,
		last,
		records: scenario,
		completedWorkers: input.completedWorkers,
	});
	const recoveryThreshold = pre.bunRss * (1 + RECOVERY_TOLERANCE_RATIO);
	const health = within(input.health, window.submittedAtMs, window.terminalAtMs);
	const pressure = within(input.pressure, window.submittedAtMs, window.completedAtMs);
	const hostLines = input.host.filter(
		({ startedMs }) => startedMs >= window.submittedAtMs && startedMs <= window.completedAtMs,
	);
	const scenarioPeak = maximum(
		present(hostLines.map((line) => line.containers.ryot?.peakSinceResetBytes)),
	);
	return {
		...preValues,
		...peaks,
		...postValues,
		...deltaValues("peakDelta", peaks, "peak", preValues),
		...deltaValues("postDelta", postValues, "post", preValues),
		"bun.lifetimeHwmBytes": last.bunHwm,
		"counters.processesSpawned": lifecycle.spawned,
		"counters.processesCompleted": lifecycle.completed,
		"counters.replaysFailed": last.replaysFailed - pre.replaysFailed,
		"counters.executions": last.executionsTotal - pre.executionsTotal,
		"workers.lifetimePeakUnobserved": lifecycle.lifetimePeakUnobserved,
		"counters.replaysStarted": last.replaysStarted - pre.replaysStarted,
		"counters.durableRequests": last.durableRequests - pre.durableRequests,
		"workers.sampledPeakRssMaxBytes": maximum(lifecycle.sampledPeakRssBytes),
		"counters.replaysCompleted": last.replaysCompleted - pre.replaysCompleted,
		"workers.lifetimePeakRssMaxBytes": maximum(lifecycle.lifetimePeakRssBytes),
		"workers.maxConcurrent": maximum(load.map(({ workers }) => workers.length)),
		"cgroup.scenarioPeakDeltaBytes": difference(scenarioPeak, pre.cgroupCurrent),
		"workers.lifetimePeakRssMedianBytes": median(lifecycle.lifetimePeakRssBytes),
		"counters.replayJournalBytes": last.replayJournalBytes - pre.replayJournalBytes,
		"imports.maxExecutingBodies": maximum(
			scenario.map(({ executingImportBodies }) => executingImportBodies),
		),
		"recovery.bunRssRecoveredAfterMs": firstAfter(
			input.records,
			window.terminalAtMs,
			(record) => record.bunRss <= recoveryThreshold,
		),
		"cpu.bunUserMs":
			difference(last.bunUserMicros, pre.bunUserMicros) === null
				? null
				: (difference(last.bunUserMicros, pre.bunUserMicros) ?? 0) / 1_000,
		"recovery.workersDrainedAfterMs": firstAfter(
			input.records,
			window.terminalAtMs,
			(record) => record.workers.length === 0 && record.activeExecutions === 0,
		),
		"cpu.bunSystemMs":
			difference(last.bunSystemMicros, pre.bunSystemMicros) === null
				? null
				: (difference(last.bunSystemMicros, pre.bunSystemMicros) ?? 0) / 1_000,
		...requestMetrics(input.requests, window),
		...spreadMetrics(
			"health.latencyMs",
			health.map(({ latencyMs }) => latencyMs),
		),
		"health.failures": health.filter(({ ok }) => !ok).length,
		"db.deadlocksDelta": difference(pressure.at(-1)?.deadlocks, pressure[0]?.deadlocks),
		"db.totalConnectionsMax": maximum(pressure.map(({ totalConnections }) => totalConnections)),
		"db.activeConnectionsMax": maximum(pressure.map(({ activeConnections }) => activeConnections)),
		"db.lockWaitingMax": maximum(
			pressure.map(({ lockWaitingConnections }) => lockWaitingConnections),
		),
		...hostMetrics(hostLines),
	};
};

/** One point per second keeps committed series bounded while preserving the shape of a scenario. */
export const downsample = <T extends { readonly t: number }>(
	records: ReadonlyArray<T>,
	bucketMs = 1_000,
) => {
	const buckets = new Map<number, T>();
	for (const record of records) {
		const bucket = Math.floor(record.t / bucketMs);
		if (!buckets.has(bucket)) {
			buckets.set(bucket, record);
		}
	}
	return [...buckets.values()];
};

export const appPoint = (record: AppRecord): AppPoint => ({
	t: record.t,
	bunRss: record.bunRss,
	denoRss: record.denoRss,
	workers: record.workers.length,
	bunHeapUsed: record.bunHeapUsed,
	bunExternal: record.bunExternal,
	bunHeapTotal: record.bunHeapTotal,
	cgroupCurrent: record.cgroupCurrent,
	bunArrayBuffers: record.bunArrayBuffers,
	activeExecutions: record.activeExecutions,
	executingImportBodies: record.executingImportBodies,
});

export const hostPoint = (line: HostSampleLine): HostPoint => ({
	t: line.startedMs,
	ioSomeAvg10: pressureAvg10(line, "io", "some"),
	cpuSomeAvg10: pressureAvg10(line, "cpu", "some"),
	memAvailable: line.meminfo?.memAvailableBytes ?? null,
	memorySomeAvg10: pressureAvg10(line, "memory", "some"),
	memoryFullAvg10: pressureAvg10(line, "memory", "full"),
	ryotMemoryCurrent: line.containers.ryot?.memoryCurrentBytes ?? null,
	otelMemoryCurrent: line.containers.otel?.memoryCurrentBytes ?? null,
	redisMemoryCurrent: line.containers.redis?.memoryCurrentBytes ?? null,
	postgresMemoryCurrent: line.containers.postgres?.memoryCurrentBytes ?? null,
});
