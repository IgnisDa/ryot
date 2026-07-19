import type {
	CpuStat,
	DiskStat,
	IoStat,
	MemInfo,
	MemoryEvents,
	MemoryStat,
	Pressure,
	PressureLine,
	VmStat,
} from "./samples";

const numberOrNull = (value: string | undefined) => {
	if (value === undefined) {
		return null;
	}
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : null;
};

export const parseKeyValues = (text: string) => {
	const values = new Map<string, number>();
	for (const line of text.split("\n")) {
		const [key, value] = line.trim().split(/\s+/);
		const parsed = numberOrNull(value);
		if (key !== undefined && key !== "" && parsed !== null) {
			values.set(key, parsed);
		}
	}
	return values;
};

export const parseMemInfo = (text: string): MemInfo => {
	const kilobytes = new Map<string, number>();
	for (const line of text.split("\n")) {
		const match = /^(\w+(?:\(\w+\))?):\s+(\d+)/.exec(line);
		if (match?.[1] !== undefined && match[2] !== undefined) {
			kilobytes.set(match[1], Number(match[2]));
		}
	}
	const bytes = (key: string) => {
		const value = kilobytes.get(key);
		return value === undefined ? null : value * 1024;
	};
	return {
		dirtyBytes: bytes("Dirty"),
		cachedBytes: bytes("Cached"),
		memTotalBytes: bytes("MemTotal"),
		swapFreeBytes: bytes("SwapFree"),
		writebackBytes: bytes("Writeback"),
		swapTotalBytes: bytes("SwapTotal"),
		memAvailableBytes: bytes("MemAvailable"),
		sReclaimableBytes: bytes("SReclaimable"),
	};
};

const parsePressureLine = (line: string | undefined): PressureLine | null => {
	if (line === undefined) {
		return null;
	}
	const fields = new Map(
		line
			.trim()
			.split(/\s+/)
			.slice(1)
			.map((pair): [string, string] => [
				pair.slice(0, pair.indexOf("=")),
				pair.slice(pair.indexOf("=") + 1),
			]),
	);
	const avg10 = numberOrNull(fields.get("avg10"));
	const avg60 = numberOrNull(fields.get("avg60"));
	const totalUs = numberOrNull(fields.get("total"));
	return avg10 === null || avg60 === null || totalUs === null ? null : { avg10, avg60, totalUs };
};

export const parsePressure = (text: string): Pressure => {
	const lines = text.split("\n");
	return {
		some: parsePressureLine(lines.find((line) => line.startsWith("some "))),
		full: parsePressureLine(lines.find((line) => line.startsWith("full "))),
	};
};

/** System-wide CPU `full` pressure is undefined and the kernel reports it as zeros. */
export const withoutZeroFull = (pressure: Pressure): Pressure =>
	pressure.full?.totalUs === 0 ? { ...pressure, full: null } : pressure;

/**
 * `pgscan_anon`/`pgscan_file` partition the same scans as the per-source counters, and
 * `pgscan_direct_throttle` counts throttling events, so only per-source counters are summed.
 */
const PGSCAN_EXCLUDED = new Set(["pgscan_anon", "pgscan_file", "pgscan_direct_throttle"]);
const PGSTEAL_EXCLUDED = new Set(["pgsteal_anon", "pgsteal_file"]);

const sumPrefixed = (values: Map<string, number>, prefix: string, excluded: Set<string>) => {
	let total: number | null = null;
	for (const [key, value] of values) {
		if (key.startsWith(prefix) && !excluded.has(key)) {
			total = (total ?? 0) + value;
		}
	}
	return total;
};

export const parseVmStat = (text: string): VmStat => {
	const values = parseKeyValues(text);
	return {
		pgfault: values.get("pgfault") ?? null,
		oomKill: values.get("oom_kill") ?? null,
		pgmajfault: values.get("pgmajfault") ?? null,
		pgscanKswapd: values.get("pgscan_kswapd") ?? null,
		pgscanDirect: values.get("pgscan_direct") ?? null,
		pgscan: sumPrefixed(values, "pgscan_", PGSCAN_EXCLUDED),
		pgsteal: sumPrefixed(values, "pgsteal_", PGSTEAL_EXCLUDED),
		workingsetRefaultAnon: values.get("workingset_refault_anon") ?? null,
		workingsetRefaultFile: values.get("workingset_refault_file") ?? null,
	};
};

export const parseDiskStat = (text: string): DiskStat => {
	const values = text.trim().split(/\s+/);
	const field = (index: number) => numberOrNull(values[index]);
	return {
		inFlight: field(8),
		ioTimeMs: field(9),
		readTimeMs: field(3),
		readsMerged: field(1),
		sectorsRead: field(2),
		writeTimeMs: field(7),
		writesMerged: field(5),
		flushTimeMs: field(16),
		readsCompleted: field(0),
		sectorsWritten: field(6),
		discardTimeMs: field(14),
		writesCompleted: field(4),
		discardsMerged: field(12),
		weightedIoTimeMs: field(10),
		sectorsDiscarded: field(13),
		flushesCompleted: field(15),
		discardsCompleted: field(11),
	};
};

export const parseMemoryStat = (text: string): MemoryStat => {
	const values = parseKeyValues(text);
	const value = (key: string) => values.get(key) ?? null;
	return {
		anon: value("anon"),
		file: value("file"),
		sock: value("sock"),
		shmem: value("shmem"),
		kernel: value("kernel"),
		pgscan: value("pgscan"),
		pgfault: value("pgfault"),
		pgsteal: value("pgsteal"),
		fileDirty: value("file_dirty"),
		pagetables: value("pagetables"),
		pgmajfault: value("pgmajfault"),
		fileMapped: value("file_mapped"),
		activeAnon: value("active_anon"),
		activeFile: value("active_file"),
		kernelStack: value("kernel_stack"),
		inactiveAnon: value("inactive_anon"),
		inactiveFile: value("inactive_file"),
		workingsetRefaultAnon: value("workingset_refault_anon"),
		workingsetRefaultFile: value("workingset_refault_file"),
	};
};

export const parseMemoryEvents = (text: string): MemoryEvents => {
	const values = parseKeyValues(text);
	return {
		low: values.get("low") ?? null,
		max: values.get("max") ?? null,
		oom: values.get("oom") ?? null,
		high: values.get("high") ?? null,
		oomKill: values.get("oom_kill") ?? null,
	};
};

export const parseCpuStat = (text: string): CpuStat => {
	const values = parseKeyValues(text);
	return {
		userUsec: values.get("user_usec") ?? null,
		usageUsec: values.get("usage_usec") ?? null,
		systemUsec: values.get("system_usec") ?? null,
		nrThrottled: values.get("nr_throttled") ?? null,
		throttledUsec: values.get("throttled_usec") ?? null,
	};
};

/** Sums every device line; a cgroup that has not issued I/O has an empty `io.stat`. */
export const parseIoStat = (text: string): IoStat => {
	const totals = new Map<string, number>();
	for (const line of text.split("\n")) {
		for (const pair of line.trim().split(/\s+/).slice(1)) {
			const [key, value] = pair.split("=");
			const parsed = numberOrNull(value);
			if (key !== undefined && parsed !== null) {
				totals.set(key, (totals.get(key) ?? 0) + parsed);
			}
		}
	}
	return {
		rios: totals.get("rios") ?? 0,
		wios: totals.get("wios") ?? 0,
		rbytes: totals.get("rbytes") ?? 0,
		wbytes: totals.get("wbytes") ?? 0,
	};
};

export const parseSingleNumber = (text: string) => numberOrNull(text.trim());

export const parseVmRssBytes = (status: string) => {
	const match = /^VmRSS:\s+(\d+)\s+kB/m.exec(status);
	return match?.[1] === undefined ? null : Number(match[1]) * 1024;
};

export const parseProcCgroup = (text: string) => {
	const line = text.split("\n").find((candidate) => candidate.startsWith("0::"));
	const path = line?.slice(3).trim();
	return path === undefined || path === "" ? null : path;
};

const VIRTUAL_BLOCK_DEVICE = /^(loop|ram|dm-|zram|sr)/;

export const pickBlockDevice = (names: ReadonlyArray<string>) =>
	[...names].sort().find((name) => !VIRTUAL_BLOCK_DEVICE.test(name)) ?? null;
