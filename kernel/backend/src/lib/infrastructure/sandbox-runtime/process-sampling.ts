import { Effect } from "effect";

export type ProcessCpuSample = {
	readonly userTicks: number;
	readonly systemTicks: number;
	readonly startTimeTicks: number;
};

export type CgroupMemoryEvents = {
	readonly low: number;
	readonly max: number;
	readonly oom: number;
	readonly high: number;
	readonly oomKill: number;
};

export type CgroupCpuStat = {
	readonly userUsec: number | null;
	readonly usageUsec: number | null;
	readonly systemUsec: number | null;
};

export type CgroupSample = {
	readonly cpu: CgroupCpuStat;
	readonly events: CgroupMemoryEvents;
	readonly pidsCurrent: number | null;
	readonly memoryMaxBytes: number | null;
	readonly memoryPeakBytes: number | null;
	readonly memoryCurrentBytes: number | null;
};

const finite = (value: number) => (Number.isFinite(value) ? value : null);

const procStatusKibibytes = (contents: string, key: string) => {
	const match = new RegExp(`^${key}:\\s+(\\d+)\\s+kB$`, "m").exec(contents);
	return match?.[1] ? Number(match[1]) * 1024 : null;
};

export const parseProcStatusRssBytes = (contents: string) => procStatusKibibytes(contents, "VmRSS");

/** `VmHWM` is the kernel's lifetime resident high-water mark for the process. */
export const parseProcStatusHwmBytes = (contents: string) => procStatusKibibytes(contents, "VmHWM");

export type SmapsRollup = {
	readonly rssBytes: number | null;
	readonly pssBytes: number | null;
	readonly swapBytes: number | null;
	readonly pssAnonBytes: number | null;
	readonly pssFileBytes: number | null;
	readonly pssShmemBytes: number | null;
	readonly anonymousBytes: number | null;
	readonly sharedCleanBytes: number | null;
	readonly sharedDirtyBytes: number | null;
	readonly privateCleanBytes: number | null;
	readonly privateDirtyBytes: number | null;
};

export const parseSmapsRollup = (contents: string): SmapsRollup => {
	const values: Record<string, number> = {};
	for (const line of contents.split("\n")) {
		const match = /^(\w+):\s+(\d+)\s+kB$/.exec(line.trim());
		if (match?.[1] && match[2]) {
			values[match[1]] = Number(match[2]) * 1024;
		}
	}
	return {
		rssBytes: values["Rss"] ?? null,
		pssBytes: values["Pss"] ?? null,
		swapBytes: values["Swap"] ?? null,
		pssAnonBytes: values["Pss_Anon"] ?? null,
		pssFileBytes: values["Pss_File"] ?? null,
		pssShmemBytes: values["Pss_Shmem"] ?? null,
		anonymousBytes: values["Anonymous"] ?? null,
		sharedCleanBytes: values["Shared_Clean"] ?? null,
		sharedDirtyBytes: values["Shared_Dirty"] ?? null,
		privateCleanBytes: values["Private_Clean"] ?? null,
		privateDirtyBytes: values["Private_Dirty"] ?? null,
	};
};

export const parseProcStatCpu = (contents: string): ProcessCpuSample | null => {
	// The second field is the executable name in parentheses and may itself contain spaces.
	const closing = contents.lastIndexOf(")");
	if (closing === -1) {
		return null;
	}
	const fields = contents
		.slice(closing + 1)
		.trim()
		.split(/\s+/);
	const userTicks = Number(fields[11]);
	const systemTicks = Number(fields[12]);
	const startTimeTicks = Number(fields[19]);
	if (!Number.isFinite(userTicks) || !Number.isFinite(systemTicks)) {
		return null;
	}
	return {
		userTicks,
		systemTicks,
		startTimeTicks: Number.isFinite(startTimeTicks) ? startTimeTicks : 0,
	};
};

export const parseCgroupNumber = (contents: string) => {
	const value = Number(contents.trim());
	return contents.trim() === "" ? null : finite(value);
};

export const parseCgroupMemoryMax = (contents: string) => {
	const value = contents.trim();
	return value === "max" ? null : parseCgroupNumber(value);
};

export const parseCgroupKeyedValues = (contents: string) => {
	const values: Record<string, number> = {};
	for (const line of contents.split("\n")) {
		const [key, raw] = line.trim().split(/\s+/);
		const value = Number(raw);
		if (key && raw !== undefined && Number.isFinite(value)) {
			values[key] = value;
		}
	}
	return values;
};

export const parseCgroupMemoryEvents = (contents: string): CgroupMemoryEvents => {
	const values = parseCgroupKeyedValues(contents);
	return {
		low: values["low"] ?? 0,
		max: values["max"] ?? 0,
		oom: values["oom"] ?? 0,
		high: values["high"] ?? 0,
		oomKill: values["oom_kill"] ?? 0,
	};
};

export const parseCgroupCpuStat = (contents: string): CgroupCpuStat => {
	const values = parseCgroupKeyedValues(contents);
	return {
		userUsec: values["user_usec"] ?? null,
		usageUsec: values["usage_usec"] ?? null,
		systemUsec: values["system_usec"] ?? null,
	};
};

const readTextFile = (path: string) =>
	Effect.tryPromise(() => Bun.file(path).text()).pipe(Effect.orElseSucceed(() => null));

const readParsed = <A>(path: string, parse: (contents: string) => A) =>
	Effect.map(readTextFile(path), (contents) => (contents === null ? null : parse(contents)));

export const readProcessCpuSample = (pid: number) =>
	readParsed(`/proc/${pid}/stat`, parseProcStatCpu);

export const readProcessRssBytes = (pid: number) =>
	readParsed(`/proc/${pid}/status`, parseProcStatusRssBytes);

export const readProcessMemoryStatus = (pid: number | "self") =>
	readParsed(`/proc/${pid}/status`, (contents) => ({
		rssBytes: parseProcStatusRssBytes(contents),
		hwmBytes: parseProcStatusHwmBytes(contents),
	}));

export const readProcessSmapsRollup = (pid: number | "self") =>
	readParsed(`/proc/${pid}/smaps_rollup`, parseSmapsRollup);

const emptyCgroupEvents: CgroupMemoryEvents = { low: 0, max: 0, oom: 0, high: 0, oomKill: 0 };
const emptyCgroupCpu: CgroupCpuStat = { userUsec: null, usageUsec: null, systemUsec: null };

export const readCgroupSample = (root = "/sys/fs/cgroup"): Effect.Effect<CgroupSample | null> =>
	Effect.gen(function* () {
		const current = yield* readParsed(`${root}/memory.current`, parseCgroupNumber);
		if (current === null) {
			return null;
		}
		const [peak, max, events, pids, cpu] = yield* Effect.all(
			[
				readParsed(`${root}/memory.peak`, parseCgroupNumber),
				readParsed(`${root}/memory.max`, parseCgroupMemoryMax),
				readParsed(`${root}/memory.events`, parseCgroupMemoryEvents),
				readParsed(`${root}/pids.current`, parseCgroupNumber),
				readParsed(`${root}/cpu.stat`, parseCgroupCpuStat),
			],
			{ concurrency: "unbounded" },
		);
		return {
			pidsCurrent: pids,
			memoryMaxBytes: max,
			memoryPeakBytes: peak,
			cpu: cpu ?? emptyCgroupCpu,
			memoryCurrentBytes: current,
			events: events ?? emptyCgroupEvents,
		};
	});
