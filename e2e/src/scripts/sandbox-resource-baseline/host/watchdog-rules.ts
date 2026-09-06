import { WatchdogCondition } from "./samples";

export type WatchdogThresholds = {
	readonly memAvailableFloorBytes: number;
	readonly memoryPsiFullAvg10Ceiling: number;
	readonly ryotMemoryCurrentCeilingBytes: number;
	readonly consecutiveEvaluations: number;
	readonly healthFailureMs: number;
};

export const DEFAULT_THRESHOLDS: WatchdogThresholds = {
	healthFailureMs: 30_000,
	consecutiveEvaluations: 5,
	memoryPsiFullAvg10Ceiling: 10,
	memAvailableFloorBytes: 384 * 1024 * 1024,
	ryotMemoryCurrentCeilingBytes: 2_684_354_560,
};

/** A drill forces the MemAvailable condition true so the streak and stop target are exercised. */
export const drillThresholds = (thresholds: WatchdogThresholds): WatchdogThresholds => ({
	...thresholds,
	memAvailableFloorBytes: Number.POSITIVE_INFINITY,
});

export type WatchdogObservation = {
	readonly nowMs: number;
	readonly memAvailableBytes: number | null;
	readonly memoryPsiFullAvg10: number | null;
	readonly hostOomKill: number | null;
	readonly hostOomKillBaseline: number | null;
	/** `null` while the Ryot container is unresolved; its cgroup conditions are then skipped. */
	readonly ryot: {
		readonly memoryCurrentBytes: number | null;
		readonly oomKill: number | null;
		readonly oomKillBaseline: number | null;
	} | null;
	readonly healthFailingSinceMs: number | null;
};

export type ConditionStates = Readonly<Record<WatchdogCondition, boolean>>;
export type WatchdogStreaks = Readonly<Record<WatchdogCondition, number>>;

export const INITIAL_STREAKS: WatchdogStreaks = {
	hostOomKill: 0,
	ryotOomKill: 0,
	healthFailing: 0,
	memAvailableLow: 0,
	memoryPsiFullHigh: 0,
	ryotMemoryCurrentHigh: 0,
};

const increased = (value: number | null, baseline: number | null) =>
	value !== null && baseline !== null && value > baseline;

export const evaluateConditions = (
	observation: WatchdogObservation,
	thresholds: WatchdogThresholds,
): ConditionStates => ({
	hostOomKill: increased(observation.hostOomKill, observation.hostOomKillBaseline),
	ryotOomKill:
		observation.ryot !== null &&
		increased(observation.ryot.oomKill, observation.ryot.oomKillBaseline),
	memoryPsiFullHigh:
		observation.memoryPsiFullAvg10 !== null &&
		observation.memoryPsiFullAvg10 > thresholds.memoryPsiFullAvg10Ceiling,
	healthFailing:
		observation.healthFailingSinceMs !== null &&
		observation.nowMs - observation.healthFailingSinceMs >= thresholds.healthFailureMs,
	ryotMemoryCurrentHigh:
		observation.ryot?.memoryCurrentBytes != null &&
		observation.ryot.memoryCurrentBytes > thresholds.ryotMemoryCurrentCeilingBytes,
	memAvailableLow:
		thresholds.memAvailableFloorBytes === Number.POSITIVE_INFINITY ||
		(observation.memAvailableBytes !== null &&
			observation.memAvailableBytes < thresholds.memAvailableFloorBytes),
});

/**
 * Each condition keeps its own streak and triggers after the configured number of consecutive true
 * evaluations. The health condition already carries its own 30 s duration, so it triggers at once.
 */
export const evaluateWatchdog = (
	streaks: WatchdogStreaks,
	observation: WatchdogObservation,
	thresholds: WatchdogThresholds,
) => {
	const states = evaluateConditions(observation, thresholds);
	const next: Record<WatchdogCondition, number> = { ...INITIAL_STREAKS };
	let trigger: WatchdogCondition | null = null;
	for (const condition of WatchdogCondition.literals) {
		next[condition] = states[condition] ? streaks[condition] + 1 : 0;
		const required = condition === "healthFailing" ? 1 : thresholds.consecutiveEvaluations;
		if (trigger === null && next[condition] >= required) {
			trigger = condition;
		}
	}
	return { states, trigger, streaks: next };
};
