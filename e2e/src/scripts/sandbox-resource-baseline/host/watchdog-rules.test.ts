import { describe, expect, it } from "~/support/effect-test";

import {
	DEFAULT_THRESHOLDS,
	drillThresholds,
	evaluateWatchdog,
	INITIAL_STREAKS,
	type WatchdogObservation,
	type WatchdogStreaks,
} from "./watchdog-rules";

const GIB = 1024 * 1024 * 1024;

const healthy: WatchdogObservation = {
	nowMs: 100_000,
	hostOomKill: 3,
	hostOomKillBaseline: 3,
	memoryPsiFullAvg10: 0.5,
	memAvailableBytes: 2 * GIB,
	healthFailingSinceMs: null,
	ryot: { oomKill: 0, oomKillBaseline: 0, memoryCurrentBytes: GIB },
};

const run = (observations: ReadonlyArray<WatchdogObservation>, thresholds = DEFAULT_THRESHOLDS) => {
	let streaks: WatchdogStreaks = INITIAL_STREAKS;
	const triggers = observations.map((observation) => {
		const evaluation = evaluateWatchdog(streaks, observation, thresholds);
		streaks = evaluation.streaks;
		return evaluation.trigger;
	});
	return triggers;
};

const repeat = (observation: WatchdogObservation, count: number) =>
	Array.from({ length: count }, () => observation);

const lowMemory: WatchdogObservation = { ...healthy, memAvailableBytes: 300 * 1024 * 1024 };

describe("evaluateWatchdog", () => {
	it("triggers only on the fifth consecutive true evaluation", () => {
		expect(run(repeat(lowMemory, 5))).toEqual([null, null, null, null, "memAvailableLow"]);
	});

	it("resets the streak when a condition clears after four evaluations", () => {
		const triggers = run([...repeat(lowMemory, 4), healthy, ...repeat(lowMemory, 4)]);
		expect(triggers.every((trigger) => trigger === null)).toBe(true);
	});

	it("keeps independent streaks per condition", () => {
		const pressure: WatchdogObservation = { ...healthy, memoryPsiFullAvg10: 12 };
		const triggers = run([lowMemory, lowMemory, pressure, pressure, pressure, pressure, pressure]);
		expect(triggers).toEqual([null, null, null, null, null, null, "memoryPsiFullHigh"]);
	});

	it("triggers on host and Ryot OOM-kill counter increases", () => {
		expect(run(repeat({ ...healthy, hostOomKill: 4 }, 5)).at(-1)).toBe("hostOomKill");
		expect(
			run(
				repeat(
					{ ...healthy, ryot: { oomKill: 1, oomKillBaseline: 0, memoryCurrentBytes: GIB } },
					5,
				),
			).at(-1),
		).toBe("ryotOomKill");
	});

	it("triggers when Ryot memory.current exceeds 2.5 GiB but not at it", () => {
		const at = {
			...healthy,
			ryot: { oomKill: 0, oomKillBaseline: 0, memoryCurrentBytes: 2_684_354_560 },
		};
		const above = {
			...healthy,
			ryot: { oomKill: 0, oomKillBaseline: 0, memoryCurrentBytes: 2_684_354_561 },
		};

		expect(run(repeat(at, 5)).at(-1)).toBeNull();
		expect(run(repeat(above, 5)).at(-1)).toBe("ryotMemoryCurrentHigh");
	});

	it("triggers once health has failed for 30 s and not at 29 s", () => {
		expect(run([{ ...healthy, healthFailingSinceMs: healthy.nowMs - 29_000 }])).toEqual([null]);
		expect(run([{ ...healthy, healthFailingSinceMs: healthy.nowMs - 30_000 }])).toEqual([
			"healthFailing",
		]);
	});

	it("forces the MemAvailable condition in drill mode", () => {
		const unreadable = { ...healthy, memAvailableBytes: null };
		expect(run(repeat(unreadable, 5), drillThresholds(DEFAULT_THRESHOLDS))).toEqual([
			null,
			null,
			null,
			null,
			"memAvailableLow",
		]);
	});

	it("skips cgroup conditions while Ryot is unresolved and keeps host conditions", () => {
		const unresolved = { ...healthy, ryot: null };
		expect(run(repeat(unresolved, 10)).every((trigger) => trigger === null)).toBe(true);
		expect(run(repeat({ ...unresolved, memAvailableBytes: 1 }, 5)).at(-1)).toBe("memAvailableLow");
	});
});
