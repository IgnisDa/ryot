import { closeSync, openSync, writeFileSync } from "node:fs";

import {
	appendLine,
	detectBlockDevice,
	metadataLine,
	readNumber,
	readParsed,
	type Resolution,
	resolveContainers,
	runCommand,
	wallClockMs,
} from "./io";
import { parseMemInfo, parseMemoryEvents, parsePressure, parseVmStat } from "./parsers";
import type { ContainerRole, WatchdogHeartbeatLine, WatchdogTriggerLine } from "./samples";
import { createStopSignal, runFixedRate } from "./schedule";
import {
	DEFAULT_THRESHOLDS,
	drillThresholds,
	evaluateWatchdog,
	INITIAL_STREAKS,
	type ConditionStates,
	type WatchdogStreaks,
} from "./watchdog-rules";

const INTERVAL_MS = 1_000;
const HEARTBEAT_MS = 60_000;
const HEALTH_TIMEOUT_MS = 2_000;
const RESOLUTION_RETRY_MS = 5_000;

export type WatchdogOptions = {
	readonly project: string;
	readonly triggerFile: string;
	readonly dryRun: boolean;
	readonly drill: boolean;
	readonly pidFile: string | null;
	readonly healthPath: string;
	readonly healthPort: number;
	readonly services: Readonly<Record<ContainerRole, string>>;
};

const hostOomKill = () => readParsed("/proc/vmstat", parseVmStat)?.oomKill ?? null;

export const runWatchdog = async (options: WatchdogOptions) => {
	const thresholds = options.drill ? drillThresholds(DEFAULT_THRESHOLDS) : DEFAULT_THRESHOLDS;
	const dryRun = options.dryRun || options.drill;
	const triggerFd = openSync(options.triggerFile, "a");
	if (options.pidFile !== null) {
		writeFileSync(options.pidFile, `${process.pid}\n`);
	}

	let resolution: Resolution = await resolveContainers(options.project, options.services);
	let resolving = false;
	let lastResolutionMs = performance.now();
	appendLine(
		1,
		metadataLine({
			resolution,
			reason: "startup",
			project: options.project,
			device: detectBlockDevice(),
		}),
	);

	const ryotContainer = () => resolution.containers.find(({ role }) => role === "ryot") ?? null;

	const requestResolution = () => {
		if (resolving || performance.now() - lastResolutionMs < RESOLUTION_RETRY_MS) {
			return;
		}
		resolving = true;
		lastResolutionMs = performance.now();
		const resolve = async () => {
			try {
				resolution = await resolveContainers(options.project, options.services);
			} finally {
				resolving = false;
			}
		};
		void resolve();
	};

	// Counters restart with each container, so the Ryot OOM baseline is taken per container start.
	const hostOomKillBaseline = hostOomKill();
	const ryotOomBaselines = new Map<string, number | null>();

	let healthFailingSinceMs: number | null = null;
	let healthInFlight = false;
	const checkHealth = () => {
		if (healthInFlight) {
			return;
		}
		const startedMs = wallClockMs();
		const address = ryotContainer()?.ipAddress ?? null;
		const recordFailure = () => {
			healthFailingSinceMs ??= startedMs;
		};
		if (address === null) {
			recordFailure();
			return;
		}
		healthInFlight = true;
		const check = async () => {
			try {
				const response = await fetch(
					`http://${address}:${options.healthPort}${options.healthPath}`,
					{ signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) },
				);
				await response.body?.cancel();
				if (response.ok) {
					healthFailingSinceMs = null;
				} else {
					recordFailure();
				}
			} catch {
				recordFailure();
			} finally {
				healthInFlight = false;
			}
		};
		void check();
	};

	let streaks: WatchdogStreaks = INITIAL_STREAKS;
	let states: ConditionStates = {
		hostOomKill: false,
		ryotOomKill: false,
		healthFailing: false,
		memAvailableLow: false,
		memoryPsiFullHigh: false,
		ryotMemoryCurrentHigh: false,
	};
	let evaluations = 0;
	let lastHeartbeatMs = performance.now();

	const heartbeat = () => {
		lastHeartbeatMs = performance.now();
		appendLine(triggerFd, {
			evaluations,
			conditionStates: states,
			kind: "watchdog-heartbeat",
			timestampMs: wallClockMs(),
			ryotContainerId: ryotContainer()?.containerId ?? null,
		} satisfies WatchdogHeartbeatLine);
	};

	const readRyot = () => {
		const ryot = ryotContainer();
		if (ryot === null) {
			requestResolution();
			return null;
		}
		const memoryCurrentBytes = readNumber(`${ryot.cgroupPath}/memory.current`);
		if (memoryCurrentBytes === null) {
			requestResolution();
			return null;
		}
		const oomKill =
			readParsed(`${ryot.cgroupPath}/memory.events`, parseMemoryEvents)?.oomKill ?? null;
		const baselineKey = `${ryot.containerId}@${ryot.startedAt}`;
		if (!ryotOomBaselines.has(baselineKey)) {
			ryotOomBaselines.set(baselineKey, oomKill);
		}
		return {
			oomKill,
			memoryCurrentBytes,
			oomKillBaseline: ryotOomBaselines.get(baselineKey) ?? null,
		};
	};

	const signal = createStopSignal();
	process.on("SIGTERM", signal.stop);
	process.on("SIGINT", signal.stop);

	heartbeat();
	await runFixedRate(INTERVAL_MS, signal, async () => {
		checkHealth();
		const evaluation = evaluateWatchdog(
			streaks,
			{
				ryot: readRyot(),
				hostOomKillBaseline,
				nowMs: wallClockMs(),
				healthFailingSinceMs,
				hostOomKill: hostOomKill(),
				memAvailableBytes: readParsed("/proc/meminfo", parseMemInfo)?.memAvailableBytes ?? null,
				memoryPsiFullAvg10: readParsed("/proc/pressure/memory", parsePressure)?.full?.avg10 ?? null,
			},
			thresholds,
		);
		evaluations += 1;
		streaks = evaluation.streaks;
		states = evaluation.states;
		if (evaluation.trigger !== null) {
			const target = ryotContainer();
			let stopExitCode: number | null = null;
			let action: WatchdogTriggerLine["action"] = "no-target";
			if (target !== null && dryRun) {
				action = "would-stop";
			} else if (target !== null) {
				const stopped = await runCommand(["docker", "stop", target.containerId]);
				stopExitCode = stopped.exitCode;
				action = "stopped";
			}
			const record: WatchdogTriggerLine = {
				dryRun,
				action,
				stopExitCode,
				drill: options.drill,
				kind: "watchdog-trigger",
				timestampMs: wallClockMs(),
				reason: evaluation.trigger,
				targetService: target?.service ?? null,
				targetContainerId: target?.containerId ?? null,
				targetContainerName: target?.containerName ?? null,
			};
			appendLine(triggerFd, record);
			appendLine(1, record);
			signal.stop();
			return;
		}
		if (performance.now() - lastHeartbeatMs >= HEARTBEAT_MS) {
			heartbeat();
		}
	});
	closeSync(triggerFd);
	process.exit(0);
};
