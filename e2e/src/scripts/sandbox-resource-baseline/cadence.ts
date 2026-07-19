import { Schema } from "effect";

/**
 * Fixed-rate sampling shared by the application and host samplers. Slots sit at
 * `originMs + index * intervalMs` on a monotonic clock; a sample starts at its slot, samples never
 * overlap, and a sample that overruns later slots skips them as missed rather than drifting.
 */
export type SlotPlan = {
	readonly missedSlots: number;
	readonly nextSlotIndex: number;
	readonly nextDeadlineMs: number;
};

export const planNextSlot = (input: {
	readonly nowMs: number;
	readonly originMs: number;
	readonly intervalMs: number;
	readonly currentSlotIndex: number;
}): SlotPlan => {
	const firstFutureIndex = Math.ceil((input.nowMs - input.originMs) / input.intervalMs);
	const nextSlotIndex = Math.max(input.currentSlotIndex + 1, firstFutureIndex);
	return {
		nextSlotIndex,
		missedSlots: nextSlotIndex - input.currentSlotIndex - 1,
		nextDeadlineMs: input.originMs + nextSlotIndex * input.intervalMs,
	};
};

export const CadenceRecord = Schema.Struct({
	/** Epoch milliseconds at which the sample request actually started. */
	startedMs: Schema.Finite,
	durationMs: Schema.Finite,
	/** Epoch milliseconds of the slot the sample was scheduled for. */
	scheduledMs: Schema.Finite,
	/** Slots skipped immediately before this sample because an earlier sample overran them. */
	missedSlotsBefore: Schema.Int,
});
export type CadenceRecord = typeof CadenceRecord.Type;

const Spread = Schema.Struct({ p50: Schema.Finite, p95: Schema.Finite, max: Schema.Finite });

export const CadenceStatistics = Schema.Struct({
	intervalMs: Spread,
	sampleCount: Schema.Int,
	missedSlots: Schema.Int,
	requestDurationMs: Spread,
	scheduledSlots: Schema.Int,
	longestGapMs: Schema.Finite,
	missedSlotRatio: Schema.Finite,
	requestedIntervalMs: Schema.Finite,
});
export type CadenceStatistics = typeof CadenceStatistics.Type;

const nearestRank = (sorted: ReadonlyArray<number>, ratio: number) =>
	sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)] ?? 0;

const spread = (values: ReadonlyArray<number>) => {
	const sorted = [...values].sort((left, right) => left - right);
	return { max: sorted.at(-1) ?? 0, p50: nearestRank(sorted, 0.5), p95: nearestRank(sorted, 0.95) };
};

/** Start-to-start intervals between consecutive samples in start order. */
export const startIntervals = (records: ReadonlyArray<CadenceRecord>) => {
	const starts = records.map(({ startedMs }) => startedMs).sort((left, right) => left - right);
	return starts.slice(1).map((start, index) => start - (starts[index] ?? start));
};

export const cadenceStatistics = (
	records: ReadonlyArray<CadenceRecord>,
	requestedIntervalMs: number,
): CadenceStatistics => {
	const intervals = startIntervals(records);
	const missedSlots = records.reduce((total, record) => total + record.missedSlotsBefore, 0);
	const scheduledSlots = records.length + missedSlots;
	return {
		missedSlots,
		scheduledSlots,
		requestedIntervalMs,
		sampleCount: records.length,
		intervalMs: spread(intervals),
		longestGapMs: intervals.length === 0 ? 0 : Math.max(...intervals),
		requestDurationMs: spread(records.map(({ durationMs }) => durationMs)),
		missedSlotRatio: scheduledSlots === 0 ? 0 : missedSlots / scheduledSlots,
	};
};

export const CadenceGate = Schema.Struct({
	p50MinMs: Schema.Finite,
	p50MaxMs: Schema.Finite,
	p95MaxMs: Schema.Finite,
	maxIntervalMs: Schema.Finite,
	maxMissedSlotRatio: Schema.Finite,
});
export type CadenceGate = typeof CadenceGate.Type;

/** Phase 1 preflight gate for the 200 ms application snapshot series. */
export const APPLICATION_CADENCE_GATE: CadenceGate = {
	p50MinMs: 0,
	p50MaxMs: 300,
	p95MaxMs: 500,
	maxIntervalMs: 2_000,
	maxMissedSlotRatio: 0.01,
};

/** Phase 2 preflight gate for the one-second host series. */
export const HOST_CADENCE_GATE: CadenceGate = {
	p50MinMs: 900,
	p50MaxMs: 1_100,
	p95MaxMs: 1_250,
	maxIntervalMs: 2_000,
	maxMissedSlotRatio: 0.01,
};

export const CadenceGateResult = Schema.Struct({
	gate: CadenceGate,
	passed: Schema.Boolean,
	statistics: CadenceStatistics,
	violations: Schema.Array(Schema.String),
});
export type CadenceGateResult = typeof CadenceGateResult.Type;

/**
 * Evaluates a series against its gate. Intervals that span a deliberate container restart are
 * excluded from the maximum-interval check only; they still count towards the other statistics.
 */
export const evaluateCadenceGate = (
	records: ReadonlyArray<CadenceRecord>,
	requestedIntervalMs: number,
	gate: CadenceGate,
	restartWindows: ReadonlyArray<{ readonly fromMs: number; readonly toMs: number }> = [],
): CadenceGateResult => {
	const statistics = cadenceStatistics(records, requestedIntervalMs);
	const starts = records.map(({ startedMs }) => startedMs).sort((left, right) => left - right);
	const unexcusedMaximum = starts.slice(1).reduce((maximum, start, index) => {
		const previous = starts[index] ?? start;
		const excused = restartWindows.some(
			(window) => previous <= window.toMs && start >= window.fromMs,
		);
		return excused ? maximum : Math.max(maximum, start - previous);
	}, 0);
	const violations = [
		...(statistics.sampleCount < 2 ? ["fewer than two samples"] : []),
		...(statistics.intervalMs.p50 < gate.p50MinMs
			? [`p50 interval ${statistics.intervalMs.p50} ms is below ${gate.p50MinMs} ms`]
			: []),
		...(statistics.intervalMs.p50 > gate.p50MaxMs
			? [`p50 interval ${statistics.intervalMs.p50} ms exceeds ${gate.p50MaxMs} ms`]
			: []),
		...(statistics.intervalMs.p95 > gate.p95MaxMs
			? [`p95 interval ${statistics.intervalMs.p95} ms exceeds ${gate.p95MaxMs} ms`]
			: []),
		...(unexcusedMaximum > gate.maxIntervalMs
			? [`maximum interval ${unexcusedMaximum} ms exceeds ${gate.maxIntervalMs} ms`]
			: []),
		...(statistics.missedSlotRatio > gate.maxMissedSlotRatio
			? [
					`missed-slot ratio ${statistics.missedSlotRatio.toFixed(4)} exceeds ${gate.maxMissedSlotRatio}`,
				]
			: []),
	];
	return { gate, statistics, violations, passed: violations.length === 0 };
};
