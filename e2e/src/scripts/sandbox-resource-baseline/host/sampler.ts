import { closeSync, openSync, writeFileSync, writeSync } from "node:fs";

import {
	appendLine,
	detectBlockDevice,
	errorMessage,
	metadataLine,
	readDescriptor,
	readNumber,
	readParsed,
	type Resolution,
	resolutionKey,
	resolveContainers,
	wallClockMs,
} from "./io";
import {
	parseCpuStat,
	parseDiskStat,
	parseIoStat,
	parseMemInfo,
	parseMemoryEvents,
	parseMemoryStat,
	parsePressure,
	parseSingleNumber,
	parseVmRssBytes,
	parseVmStat,
	withoutZeroFull,
} from "./parsers";
import { verifyPeakReset } from "./peak-reset";
import type {
	ContainerRole,
	ContainerSample,
	HostSampleLine,
	PeakResetLine,
	ResolvedContainer,
} from "./samples";
import { createStopSignal, runFixedRate, type Slot } from "./schedule";

const RESOLUTION_RETRY_MS = 5_000;

export type SamplerOptions = {
	readonly project: string;
	readonly output: string;
	readonly intervalMs: number;
	readonly device: string | null;
	readonly pidFile: string | null;
	readonly services: Readonly<Record<ContainerRole, string>>;
};

type HeldPeak = { readonly containerId: string; readonly fd: number };

export const runSampler = async (options: SamplerOptions) => {
	const device = options.device ?? detectBlockDevice();
	const outputFd = openSync(options.output, "a");
	if (options.pidFile !== null) {
		writeFileSync(options.pidFile, `${process.pid}\n`);
	}

	let resolution: Resolution = await resolveContainers(options.project, options.services);
	let resolving = false;
	let lastResolutionMs = performance.now();
	let heldPeak: HeldPeak | null = null;
	appendLine(
		outputFd,
		metadataLine({ device, resolution, reason: "startup", project: options.project }),
	);

	const dropHeldPeak = () => {
		if (heldPeak !== null) {
			closeSync(heldPeak.fd);
			heldPeak = null;
		}
	};

	const container = (role: ContainerRole) =>
		resolution.containers.find((candidate) => candidate.role === role) ?? null;

	const applyResolution = (next: Resolution) => {
		if (resolutionKey(next) === resolutionKey(resolution)) {
			return;
		}
		const previousRyot = container("ryot");
		resolution = next;
		const ryot = container("ryot");
		if (
			ryot?.containerId !== previousRyot?.containerId ||
			ryot?.startedAt !== previousRyot?.startedAt
		) {
			dropHeldPeak();
		}
		appendLine(
			outputFd,
			metadataLine({ device, resolution, project: options.project, reason: "restart-detected" }),
		);
	};

	// Docker runs only here, off the sampling path: the loop keeps its slots while this awaits.
	const requestResolution = () => {
		if (resolving || performance.now() - lastResolutionMs < RESOLUTION_RETRY_MS) {
			return;
		}
		resolving = true;
		lastResolutionMs = performance.now();
		const resolve = async () => {
			try {
				applyResolution(await resolveContainers(options.project, options.services));
			} finally {
				resolving = false;
			}
		};
		void resolve();
	};

	const readPeakSinceReset = (resolved: ResolvedContainer) => {
		if (heldPeak === null || heldPeak.containerId !== resolved.containerId) {
			return null;
		}
		try {
			return parseSingleNumber(readDescriptor(heldPeak.fd));
		} catch {
			dropHeldPeak();
			requestResolution();
			return null;
		}
	};

	const sampleContainer = (resolved: ResolvedContainer | null): ContainerSample | null => {
		if (resolved === null) {
			return null;
		}
		const path = resolved.cgroupPath;
		const memoryCurrentBytes = readNumber(`${path}/memory.current`);
		if (memoryCurrentBytes === null) {
			return null;
		}
		return {
			memoryCurrentBytes,
			containerId: resolved.containerId,
			pidsCurrent: readNumber(`${path}/pids.current`),
			memoryPeakBytes: readNumber(`${path}/memory.peak`),
			ioStat: readParsed(`${path}/io.stat`, parseIoStat),
			cpuStat: readParsed(`${path}/cpu.stat`, parseCpuStat),
			memoryStat: readParsed(`${path}/memory.stat`, parseMemoryStat),
			memoryEvents: readParsed(`${path}/memory.events`, parseMemoryEvents),
			peakSinceResetBytes: resolved.role === "ryot" ? readPeakSinceReset(resolved) : null,
		};
	};

	const sample = (slot: Slot) => {
		const containers = {
			ryot: sampleContainer(container("ryot")),
			otel: sampleContainer(container("otel")),
			redis: sampleContainer(container("redis")),
			postgres: sampleContainer(container("postgres")),
		};
		const cpuPressure = readParsed("/proc/pressure/cpu", parsePressure);
		const meminfo = readParsed("/proc/meminfo", parseMemInfo);
		const memoryPressure = readParsed("/proc/pressure/memory", parsePressure);
		const ioPressure = readParsed("/proc/pressure/io", parsePressure);
		const vmstat = readParsed("/proc/vmstat", parseVmStat);
		const disk = device === null ? null : readParsed(`/sys/block/${device}/stat`, parseDiskStat);
		const rssBytes = readParsed("/proc/self/status", parseVmRssBytes);
		appendLine(outputFd, {
			disk,
			device,
			vmstat,
			meminfo,
			containers,
			kind: "sample",
			sampler: { rssBytes },
			startedMs: slot.startedMs,
			timestampMs: slot.startedMs,
			scheduledMs: slot.scheduledMs,
			missedSlotsBefore: slot.missedSlotsBefore,
			durationMs: performance.now() - slot.startedMonotonicMs,
			pressure: {
				io: ioPressure,
				memory: memoryPressure,
				cpu: cpuPressure === null ? null : withoutZeroFull(cpuPressure),
			},
		} satisfies HostSampleLine);
		if (Object.values(containers).some((value) => value === null)) {
			requestResolution();
		}
	};

	// Since kernel 6.12 a write to memory.peak resets the peak only for reads through the same open
	// descriptor, so the descriptor that performed the reset is held and read for every later sample.
	const resetPeak = () => {
		dropHeldPeak();
		const ryot = container("ryot");
		const record = (fields: Omit<PeakResetLine, "kind" | "timestampMs" | "containerId">) =>
			appendLine(outputFd, {
				kind: "peak-reset",
				timestampMs: wallClockMs(),
				containerId: ryot?.containerId ?? null,
				...fields,
			} satisfies PeakResetLine);
		if (ryot === null) {
			record({
				verified: false,
				supported: false,
				lifetimePeakBytes: null,
				memoryCurrentBytes: null,
				valueAfterResetBytes: null,
				error: "ryot container unresolved",
			});
			return;
		}
		let fd: number | null = null;
		let writeSucceeded = false;
		let valueAfterResetBytes: number | null = null;
		let error: string | null = null;
		try {
			fd = openSync(`${ryot.cgroupPath}/memory.peak`, "r+");
			writeSync(fd, "reset\n");
			writeSucceeded = true;
			valueAfterResetBytes = parseSingleNumber(readDescriptor(fd));
		} catch (cause) {
			error = errorMessage(cause);
		}
		const memoryCurrentBytes = readNumber(`${ryot.cgroupPath}/memory.current`);
		const lifetimePeakBytes = readNumber(`${ryot.cgroupPath}/memory.peak`);
		const verdict = verifyPeakReset({
			writeSucceeded,
			lifetimePeakBytes,
			memoryCurrentBytes,
			valueAfterResetBytes,
		});
		if (fd !== null) {
			if (verdict.verified) {
				heldPeak = { fd, containerId: ryot.containerId };
			} else {
				closeSync(fd);
			}
		}
		record({ ...verdict, error, lifetimePeakBytes, memoryCurrentBytes, valueAfterResetBytes });
	};

	const signal = createStopSignal();
	process.on("SIGTERM", signal.stop);
	process.on("SIGINT", signal.stop);
	process.on("SIGUSR1", resetPeak);

	await runFixedRate(options.intervalMs, signal, sample);
	dropHeldPeak();
	closeSync(outputFd);
	process.exit(0);
};

export const printMetadata = async (input: {
	readonly project: string;
	readonly device: string | null;
	readonly services: Readonly<Record<ContainerRole, string>>;
}) => {
	const resolution = await resolveContainers(input.project, input.services);
	appendLine(
		1,
		metadataLine({
			resolution,
			reason: "manual",
			project: input.project,
			device: input.device ?? detectBlockDevice(),
		}),
	);
};
