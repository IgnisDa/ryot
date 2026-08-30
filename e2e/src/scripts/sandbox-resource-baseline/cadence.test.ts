import { describe, expect, it } from "~/support/effect-test";

import {
	APPLICATION_CADENCE_GATE,
	type CadenceRecord,
	cadenceStatistics,
	evaluateCadenceGate,
	HOST_CADENCE_GATE,
	planNextSlot,
} from "./cadence";

const series = (starts: ReadonlyArray<number>, missed: ReadonlyArray<number> = []) =>
	starts.map(
		(startedMs, index): CadenceRecord => ({
			startedMs,
			durationMs: 20,
			scheduledMs: startedMs,
			missedSlotsBefore: missed[index] ?? 0,
		}),
	);

describe("planNextSlot", () => {
	it("advances to the adjacent slot when the sample finished inside its interval", () => {
		expect(
			planNextSlot({ nowMs: 1_650, originMs: 1_000, intervalMs: 200, currentSlotIndex: 3 }),
		).toEqual({ missedSlots: 0, nextSlotIndex: 4, nextDeadlineMs: 1_800 });
	});

	it("skips overrun slots as missed and schedules the next future deadline", () => {
		expect(planNextSlot({ nowMs: 730, originMs: 0, intervalMs: 200, currentSlotIndex: 0 })).toEqual(
			{ missedSlots: 3, nextSlotIndex: 4, nextDeadlineMs: 800 },
		);
	});

	it("starts a sample that finishes exactly on a deadline at that deadline", () => {
		expect(planNextSlot({ nowMs: 400, originMs: 0, intervalMs: 200, currentSlotIndex: 0 })).toEqual(
			{ missedSlots: 1, nextSlotIndex: 2, nextDeadlineMs: 400 },
		);
	});
});

describe("cadenceStatistics", () => {
	it("reports observed start-to-start intervals, missed slots, and the longest gap", () => {
		const statistics = cadenceStatistics(series([0, 200, 400, 1_000, 1_200], [0, 0, 0, 2, 0]), 200);

		expect(statistics.intervalMs).toEqual({ p50: 200, p95: 600, max: 600 });
		expect(statistics.missedSlots).toBe(2);
		expect(statistics.scheduledSlots).toBe(7);
		expect(statistics.longestGapMs).toBe(600);
	});
});

describe("evaluateCadenceGate", () => {
	it("passes a steady 200 ms application series", () => {
		const starts = Array.from({ length: 100 }, (_unused, index) => index * 200);
		expect(evaluateCadenceGate(series(starts), 200, APPLICATION_CADENCE_GATE).passed).toBe(true);
	});

	it("fails a series whose missed-slot ratio exceeds one percent", () => {
		const starts = Array.from({ length: 50 }, (_unused, index) => index * 200);
		const result = evaluateCadenceGate(series(starts, [0, 0, 0, 1]), 200, APPLICATION_CADENCE_GATE);

		expect(result.passed).toBe(false);
		expect(result.violations).toEqual(["missed-slot ratio 0.0196 exceeds 0.01"]);
	});

	it("excuses a gap only when it spans a declared container restart window", () => {
		const starts = [
			...Array.from({ length: 50 }, (_unused, index) => 1_000 * index),
			...Array.from({ length: 50 }, (_unused, index) => 60_000 + 1_000 * index),
		];

		expect(evaluateCadenceGate(series(starts), 1_000, HOST_CADENCE_GATE).violations).toEqual([
			"maximum interval 11000 ms exceeds 2000 ms",
		]);
		expect(
			evaluateCadenceGate(series(starts), 1_000, HOST_CADENCE_GATE, [
				{ toMs: 58_000, fromMs: 50_000 },
			]).passed,
		).toBe(true);
	});

	it("fails a host series that runs faster than its lower p50 bound", () => {
		const starts = Array.from({ length: 30 }, (_unused, index) => index * 500);
		expect(evaluateCadenceGate(series(starts), 1_000, HOST_CADENCE_GATE).violations).toEqual([
			"p50 interval 500 ms is below 900 ms",
		]);
	});
});
