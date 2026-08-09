import { describe, expect, it } from "vitest";

import {
	formatRelativeTime,
	formatRunDuration,
	isTerminalRunStatus,
	percentRunProgress,
	runDurationLabel,
	runStartedLabel,
	runTimestampLabel,
} from "./run-status";

const NOW = Date.parse("2026-03-13T09:02:00.000Z");

const completed = {
	status: "completed",
	startedAt: "2026-03-12T21:40:05.000Z",
	finishedAt: "2026-03-12T21:44:12.000Z",
} as const;

const running = {
	finishedAt: null,
	status: "running",
	createdAt: "2026-03-13T09:00:00.000Z",
	startedAt: "2026-03-13T09:00:00.000Z",
} as const;

describe("run status presentation", () => {
	it("treats only finished runs as terminal", () => {
		expect((["pending", "running"] as const).map(isTerminalRunStatus)).toEqual([false, false]);
		expect((["completed", "failed"] as const).map(isTerminalRunStatus)).toEqual([true, true]);
	});

	it("clamps and rounds an already-percentage progress value", () => {
		expect(percentRunProgress(42.4)).toEqual({ kind: "determinate", label: "42%", percent: 42 });
		expect(percentRunProgress(-5)).toEqual({ kind: "determinate", label: "0%", percent: 0 });
		expect(percentRunProgress(140)).toEqual({ kind: "determinate", label: "100%", percent: 100 });
	});

	it("formats durations and only reports one once a run has started", () => {
		expect([900, 8_000, 72_000, 120_000, 7_500_000].map(formatRunDuration)).toEqual([
			"1s",
			"8s",
			"1m 12s",
			"2m",
			"2h 5m",
		]);
		expect(runDurationLabel(completed, NOW)).toBe("4m 7s");
		expect(runDurationLabel(running, NOW)).toBe("2m");
		expect(runDurationLabel({ ...running, startedAt: null }, NOW)).toBeUndefined();
	});

	it("describes when a run happened in words", () => {
		expect(formatRelativeTime("2026-03-13T09:01:50.000Z", NOW)).toBe("just now");
		expect(formatRelativeTime("2026-03-13T09:00:00.000Z", NOW)).toBe("2 minutes ago");
		expect(formatRelativeTime("2026-03-13T08:00:00.000Z", NOW)).toBe("1 hour ago");
		expect(formatRelativeTime("2026-03-12T08:00:00.000Z", NOW)).toBe("yesterday");
		expect(formatRelativeTime("2026-02-01T08:00:00.000Z", NOW)).toBe("Feb 1, 2026");
		expect(runStartedLabel(running, NOW)).toBe("Started 2 minutes ago");
	});

	it("stamps the detail overline with the date and time of the run", () => {
		expect(runTimestampLabel("2026-03-12T21:40:00.000Z")).toBe("12 Mar 2026, 21:40");
	});
});
