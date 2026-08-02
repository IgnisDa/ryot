import type { ImportAccounting, PhaseSummary } from "./artifacts";
import { median, p95 } from "./statistics";

export type PhaseSegment = {
	readonly sequence: number;
	readonly executionId: string;
	readonly startedAtMs: number;
	readonly finishedAtMs: number;
	readonly outcome: "success" | "failure" | "interrupted";
	readonly phase: "population" | "provider-import-automation";
};

type LogicalPhase = {
	readonly executionId: string;
	readonly phase: PhaseSegment["phase"];
	readonly startedAtMs: number;
	readonly finishedAtMs: number;
	readonly failed: boolean;
};

/**
 * A replayed workflow body records the same phase again for the same execution, so segments are
 * merged per execution and phase: the logical interval runs from the first attempt's start to the
 * end of the first terminal attempt; later terminal segments are replays of a finished phase.
 */
export const logicalPhases = (segments: ReadonlyArray<PhaseSegment>): LogicalPhase[] => {
	const grouped = new Map<string, PhaseSegment[]>();
	for (const segment of segments) {
		const key = `${segment.executionId}|${segment.phase}`;
		grouped.set(key, [...(grouped.get(key) ?? []), segment]);
	}
	return [...grouped.values()].flatMap((attempts) => {
		const terminal = attempts.filter(({ outcome }) => outcome !== "interrupted");
		const first = attempts[0];
		if (first === undefined || terminal.length === 0) {
			return [];
		}
		const ending = terminal.reduce((earliest, candidate) =>
			candidate.finishedAtMs < earliest.finishedAtMs ? candidate : earliest,
		);
		return [
			{
				phase: first.phase,
				executionId: first.executionId,
				finishedAtMs: ending.finishedAtMs,
				failed: ending.outcome === "failure",
				startedAtMs: Math.min(
					...attempts
						.filter(({ startedAtMs }) => startedAtMs <= ending.finishedAtMs)
						.map(({ startedAtMs }) => startedAtMs),
				),
			},
		];
	});
};

const maxConcurrent = (intervals: ReadonlyArray<{ startedAtMs: number; finishedAtMs: number }>) => {
	const events = intervals
		.flatMap(({ startedAtMs, finishedAtMs }) => [
			{ change: 1, at: startedAtMs },
			{ change: -1, at: finishedAtMs },
		])
		.sort((left, right) => left.at - right.at || left.change - right.change);
	let active = 0;
	let peak = 0;
	for (const event of events) {
		active += event.change;
		peak = Math.max(peak, active);
	}
	return peak;
};

/** Total time during which at least one population and one automation phase ran at once. */
const overlapMs = (
	left: ReadonlyArray<{ startedAtMs: number; finishedAtMs: number }>,
	right: ReadonlyArray<{ startedAtMs: number; finishedAtMs: number }>,
) => {
	const points = [...left, ...right]
		.flatMap(({ startedAtMs, finishedAtMs }) => [startedAtMs, finishedAtMs])
		.sort((a, b) => a - b);
	let total = 0;
	for (let index = 1; index < points.length; index += 1) {
		const from = points[index - 1] ?? 0;
		const to = points[index] ?? 0;
		const middle = (from + to) / 2;
		const active = (intervals: typeof left) =>
			intervals.some(
				({ startedAtMs, finishedAtMs }) => startedAtMs <= middle && middle < finishedAtMs,
			);
		if (to > from && active(left) && active(right)) {
			total += to - from;
		}
	}
	return total;
};

export const summarizePhases = (segments: ReadonlyArray<PhaseSegment>): PhaseSummary => {
	const logical = logicalPhases(segments);
	const byPhase = (phase: PhaseSegment["phase"]) =>
		logical.filter((entry) => entry.phase === phase);
	const population = byPhase("population");
	const automation = byPhase("provider-import-automation");
	return {
		maxConcurrentAnyPhase: maxConcurrent(logical),
		replayedSegments: segments.length - logical.length,
		populationAutomationOverlapMs: overlapMs(population, automation),
		executions: new Set(logical.map(({ executionId }) => executionId)).size,
		phases: (["population", "provider-import-automation"] as const).map((phase) => {
			const entries = byPhase(phase);
			const durations = entries.map(({ startedAtMs, finishedAtMs }) => finishedAtMs - startedAtMs);
			return {
				phase,
				count: entries.length,
				maxConcurrent: maxConcurrent(entries),
				failed: entries.filter(({ failed }) => failed).length,
				durationMs: {
					p95: p95(durations) ?? 0,
					p50: median(durations) ?? 0,
					max: durations.length === 0 ? 0 : Math.max(...durations),
				},
			};
		}),
	};
};

export type ImportRecord = {
	readonly jobId: string;
	readonly submittedAtMs: number;
	readonly terminalAtMs: number | null;
	readonly outcome: "completed" | "failed" | null;
	readonly failureStage: string | null;
};

/**
 * Logical import state comes from benchmark-owned submission and terminal records keyed by job ID,
 * so repeated terminal observations after a restart count once and never drive pending negative.
 */
export const accountImports = (records: ReadonlyArray<ImportRecord>): ImportAccounting => {
	const byJob = new Map<string, ImportRecord>();
	for (const record of records) {
		const existing = byJob.get(record.jobId);
		const kept =
			existing !== undefined &&
			existing.terminalAtMs !== null &&
			(record.terminalAtMs === null || existing.terminalAtMs <= record.terminalAtMs)
				? existing
				: record;
		byJob.set(record.jobId, {
			...kept,
			submittedAtMs: Math.min(
				existing?.submittedAtMs ?? record.submittedAtMs,
				record.submittedAtMs,
			),
		});
	}
	const jobs = [...byJob.values()];
	const terminal = jobs.filter(({ terminalAtMs }) => terminalAtMs !== null);
	const failedByStage: Record<string, number> = {};
	for (const job of terminal) {
		if (job.outcome === "failed") {
			const stage = job.failureStage ?? "unknown";
			failedByStage[stage] = (failedByStage[stage] ?? 0) + 1;
		}
	}
	const pending = jobs.map(({ terminalAtMs, submittedAtMs }) => ({
		startedAtMs: submittedAtMs,
		finishedAtMs: terminalAtMs ?? Number.POSITIVE_INFINITY,
	}));
	return {
		failedByStage,
		submitted: jobs.length,
		terminal: terminal.length,
		maxLogicalPending: maxConcurrent(pending),
		completed: terminal.filter(({ outcome }) => outcome === "completed").length,
	};
};
