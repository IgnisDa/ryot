import { describe, expect, it } from "~/support/effect-test";

import { accountImports, logicalPhases, type PhaseSegment, summarizePhases } from "./phases";

const segment = (
	sequence: number,
	executionId: string,
	phase: PhaseSegment["phase"],
	startedAtMs: number,
	finishedAtMs: number,
	outcome: PhaseSegment["outcome"] = "success",
): PhaseSegment => ({ phase, outcome, sequence, executionId, startedAtMs, finishedAtMs });

describe("logicalPhases", () => {
	it("merges a suspended attempt and its replay into one logical phase", () => {
		expect(
			logicalPhases([
				segment(1, "import-a", "population", 0, 400, "interrupted"),
				segment(2, "import-a", "population", 1_000, 1_010),
			]),
		).toEqual([
			{
				failed: false,
				startedAtMs: 0,
				phase: "population",
				finishedAtMs: 1_010,
				executionId: "import-a",
			},
		]);
	});

	it("drops a phase whose only attempts were interrupted", () => {
		expect(logicalPhases([segment(1, "import-a", "population", 0, 400, "interrupted")])).toEqual(
			[],
		);
	});
});

describe("summarizePhases", () => {
	it("does not double-count replayed segments and measures cross-import overlap", () => {
		const summary = summarizePhases([
			segment(1, "import-a", "population", 0, 100, "interrupted"),
			segment(2, "import-a", "population", 150, 1_000),
			segment(3, "import-a", "population", 5_000, 5_001),
			segment(4, "import-a", "provider-import-automation", 1_000, 1_500),
			segment(5, "import-b", "population", 1_200, 2_000),
			segment(6, "import-b", "provider-import-automation", 2_000, 2_100, "failure"),
		]);

		expect(summary.executions).toBe(2);
		expect(summary.replayedSegments).toBe(2);
		expect(
			summary.phases.map(({ phase, count, failed, maxConcurrent }) => ({
				phase,
				count,
				failed,
				maxConcurrent,
			})),
		).toEqual([
			{ count: 2, failed: 0, maxConcurrent: 1, phase: "population" },
			{ count: 2, failed: 1, maxConcurrent: 1, phase: "provider-import-automation" },
		]);
		expect(summary.populationAutomationOverlapMs).toBe(300);
		expect(summary.maxConcurrentAnyPhase).toBe(2);
	});
});

describe("accountImports", () => {
	it("counts a job once when its terminal state is observed again after a restart", () => {
		const accounting = accountImports([
			{
				jobId: "job-1",
				submittedAtMs: 0,
				terminalAtMs: 900,
				failureStage: null,
				outcome: "completed",
			},
			{
				jobId: "job-1",
				submittedAtMs: 0,
				failureStage: null,
				terminalAtMs: 1_400,
				outcome: "completed",
			},
			{
				jobId: "job-2",
				submittedAtMs: 10,
				outcome: "failed",
				terminalAtMs: 1_000,
				failureStage: "population",
			},
			{ outcome: null, jobId: "job-3", submittedAtMs: 20, terminalAtMs: null, failureStage: null },
		]);

		expect(accounting).toEqual({
			terminal: 2,
			submitted: 3,
			completed: 1,
			maxLogicalPending: 3,
			failedByStage: { population: 1 },
		});
	});
});
