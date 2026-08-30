import { Exit, Schema } from "effect";

import { CadenceRecord } from "../cadence";

const Count = Schema.NullOr(Schema.Finite);

export const ContainerRole = Schema.Literals(["ryot", "postgres", "redis", "otel"]);
export type ContainerRole = typeof ContainerRole.Type;

export const MemInfo = Schema.Struct({
	dirtyBytes: Count,
	cachedBytes: Count,
	memTotalBytes: Count,
	swapFreeBytes: Count,
	writebackBytes: Count,
	swapTotalBytes: Count,
	memAvailableBytes: Count,
	sReclaimableBytes: Count,
});
export type MemInfo = typeof MemInfo.Type;

export const PressureLine = Schema.Struct({
	avg10: Schema.Finite,
	avg60: Schema.Finite,
	totalUs: Schema.Finite,
});
export type PressureLine = typeof PressureLine.Type;

export const Pressure = Schema.Struct({
	some: Schema.NullOr(PressureLine),
	full: Schema.NullOr(PressureLine),
});
export type Pressure = typeof Pressure.Type;

export const VmStat = Schema.Struct({
	pgscan: Count,
	pgfault: Count,
	oomKill: Count,
	pgsteal: Count,
	pgmajfault: Count,
	pgscanKswapd: Count,
	pgscanDirect: Count,
	workingsetRefaultAnon: Count,
	workingsetRefaultFile: Count,
});
export type VmStat = typeof VmStat.Type;

export const DiskStat = Schema.Struct({
	inFlight: Count,
	ioTimeMs: Count,
	readTimeMs: Count,
	readsMerged: Count,
	sectorsRead: Count,
	writeTimeMs: Count,
	flushTimeMs: Count,
	writesMerged: Count,
	discardTimeMs: Count,
	readsCompleted: Count,
	sectorsWritten: Count,
	discardsMerged: Count,
	writesCompleted: Count,
	weightedIoTimeMs: Count,
	sectorsDiscarded: Count,
	flushesCompleted: Count,
	discardsCompleted: Count,
});
export type DiskStat = typeof DiskStat.Type;

export const MemoryStat = Schema.Struct({
	anon: Count,
	file: Count,
	sock: Count,
	shmem: Count,
	kernel: Count,
	pgscan: Count,
	pgfault: Count,
	pgsteal: Count,
	fileDirty: Count,
	pagetables: Count,
	fileMapped: Count,
	activeAnon: Count,
	activeFile: Count,
	pgmajfault: Count,
	kernelStack: Count,
	inactiveAnon: Count,
	inactiveFile: Count,
	workingsetRefaultAnon: Count,
	workingsetRefaultFile: Count,
});
export type MemoryStat = typeof MemoryStat.Type;

export const MemoryEvents = Schema.Struct({
	low: Count,
	max: Count,
	oom: Count,
	high: Count,
	oomKill: Count,
});
export type MemoryEvents = typeof MemoryEvents.Type;

export const CpuStat = Schema.Struct({
	userUsec: Count,
	usageUsec: Count,
	systemUsec: Count,
	nrThrottled: Count,
	throttledUsec: Count,
});
export type CpuStat = typeof CpuStat.Type;

export const IoStat = Schema.Struct({
	rios: Schema.Finite,
	wios: Schema.Finite,
	rbytes: Schema.Finite,
	wbytes: Schema.Finite,
});
export type IoStat = typeof IoStat.Type;

export const ContainerSample = Schema.Struct({
	pidsCurrent: Count,
	/** Lifetime cgroup peak read through a fresh descriptor; never a per-scenario peak. */
	memoryPeakBytes: Count,
	containerId: Schema.String,
	/** Ryot only: peak since the last verified SIGUSR1 reset, read through the held descriptor. */
	peakSinceResetBytes: Count,
	ioStat: Schema.NullOr(IoStat),
	cpuStat: Schema.NullOr(CpuStat),
	memoryCurrentBytes: Schema.Finite,
	memoryStat: Schema.NullOr(MemoryStat),
	memoryEvents: Schema.NullOr(MemoryEvents),
});
export type ContainerSample = typeof ContainerSample.Type;

export const HostSampleLine = Schema.Struct({
	...CadenceRecord.fields,
	timestampMs: Schema.Finite,
	vmstat: Schema.NullOr(VmStat),
	disk: Schema.NullOr(DiskStat),
	kind: Schema.Literal("sample"),
	meminfo: Schema.NullOr(MemInfo),
	device: Schema.NullOr(Schema.String),
	sampler: Schema.Struct({ rssBytes: Count }),
	pressure: Schema.Struct({
		io: Schema.NullOr(Pressure),
		cpu: Schema.NullOr(Pressure),
		memory: Schema.NullOr(Pressure),
	}),
	containers: Schema.Struct({
		ryot: Schema.NullOr(ContainerSample),
		otel: Schema.NullOr(ContainerSample),
		redis: Schema.NullOr(ContainerSample),
		postgres: Schema.NullOr(ContainerSample),
	}),
});
export type HostSampleLine = typeof HostSampleLine.Type;

export const ResolvedContainer = Schema.Struct({
	pid: Schema.Int,
	role: ContainerRole,
	service: Schema.String,
	imageId: Schema.String,
	startedAt: Schema.String,
	restartCount: Schema.Int,
	oomKilled: Schema.Boolean,
	cgroupPath: Schema.String,
	containerId: Schema.String,
	containerName: Schema.String,
	ipAddress: Schema.NullOr(Schema.String),
	imageRepoDigests: Schema.Array(Schema.String),
});
export type ResolvedContainer = typeof ResolvedContainer.Type;

export const UnresolvedRole = Schema.Struct({ role: ContainerRole, reason: Schema.String });
export type UnresolvedRole = typeof UnresolvedRole.Type;

export const HostMetadataLine = Schema.Struct({
	project: Schema.String,
	timestampMs: Schema.Finite,
	kind: Schema.Literal("metadata"),
	device: Schema.NullOr(Schema.String),
	unresolved: Schema.Array(UnresolvedRole),
	containers: Schema.Array(ResolvedContainer),
	reason: Schema.Literals(["startup", "restart-detected", "manual"]),
});
export type HostMetadataLine = typeof HostMetadataLine.Type;

export const PeakResetLine = Schema.Struct({
	verified: Schema.Boolean,
	lifetimePeakBytes: Count,
	supported: Schema.Boolean,
	memoryCurrentBytes: Count,
	timestampMs: Schema.Finite,
	valueAfterResetBytes: Count,
	kind: Schema.Literal("peak-reset"),
	error: Schema.NullOr(Schema.String),
	containerId: Schema.NullOr(Schema.String),
});
export type PeakResetLine = typeof PeakResetLine.Type;

export const JournalLine = Schema.Struct({
	since: Schema.String,
	until: Schema.String,
	lineCount: Schema.Int,
	truncated: Schema.Boolean,
	kind: Schema.Literal("journal"),
	lines: Schema.Array(Schema.String),
	error: Schema.NullOr(Schema.String),
});
export type JournalLine = typeof JournalLine.Type;

export const WatchdogCondition = Schema.Literals([
	"memAvailableLow",
	"memoryPsiFullHigh",
	"hostOomKill",
	"ryotOomKill",
	"ryotMemoryCurrentHigh",
	"healthFailing",
]);
export type WatchdogCondition = typeof WatchdogCondition.Type;

export const WatchdogTriggerLine = Schema.Struct({
	drill: Schema.Boolean,
	dryRun: Schema.Boolean,
	reason: WatchdogCondition,
	timestampMs: Schema.Finite,
	stopExitCode: Schema.NullOr(Schema.Int),
	kind: Schema.Literal("watchdog-trigger"),
	targetService: Schema.NullOr(Schema.String),
	targetContainerId: Schema.NullOr(Schema.String),
	targetContainerName: Schema.NullOr(Schema.String),
	action: Schema.Literals(["stopped", "would-stop", "no-target"]),
});
export type WatchdogTriggerLine = typeof WatchdogTriggerLine.Type;

export const WatchdogHeartbeatLine = Schema.Struct({
	evaluations: Schema.Int,
	timestampMs: Schema.Finite,
	kind: Schema.Literal("watchdog-heartbeat"),
	ryotContainerId: Schema.NullOr(Schema.String),
	conditionStates: Schema.Record(WatchdogCondition, Schema.Boolean),
});
export type WatchdogHeartbeatLine = typeof WatchdogHeartbeatLine.Type;

export const HostLine = Schema.Union([
	HostSampleLine,
	HostMetadataLine,
	PeakResetLine,
	JournalLine,
	WatchdogTriggerLine,
	WatchdogHeartbeatLine,
]);
export type HostLine = typeof HostLine.Type;

const decodeHostLine = Schema.decodeUnknownExit(Schema.fromJsonString(HostLine));

export const decodeHostLines = (contents: string) => {
	const lines: Array<HostLine> = [];
	let undecodable = 0;
	for (const line of contents.split("\n")) {
		if (line.trim() === "") {
			continue;
		}
		const exit = decodeHostLine(line);
		if (Exit.isSuccess(exit)) {
			lines.push(exit.value);
		} else {
			undecodable += 1;
		}
	}
	return { lines, undecodable };
};
