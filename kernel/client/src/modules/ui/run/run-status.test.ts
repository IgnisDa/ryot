import { describe, expect, it } from "vitest";

import {
	formatRelativeTime,
	formatRunCount,
	formatRunDuration,
	isTerminalRunStatus,
	runDurationLabel,
	runStartedLabel,
	runStatusPill,
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

	it("clamps and rounds run counts", () => {
		expect(formatRunCount(42.4)).toBe("42");
		expect(formatRunCount(42.5)).toBe("43");
		expect(formatRunCount(-5)).toBe("0");
		expect(formatRunCount(1_234.5)).toBe("1,235");
	});

	it("maps every run status to its pill", () => {
		expect((["pending", "running", "completed", "failed"] as const).map(runStatusPill)).toEqual([
			{ icon: "clock", tone: "muted", label: "Queued" },
			{ tone: "info", label: "Running", icon: "rotate-ccw" },
			{ tone: "success", label: "Completed", icon: "circle-check" },
			{ tone: "danger", label: "Failed", icon: "circle-alert" },
		]);
	});

	it("formats durations at seconds, minutes, and hours boundaries", () => {
		expect(
			[0, 499, 500, 59_500, 61_000, 3_599_000, 3_600_000, 7_500_000].map(formatRunDuration),
		).toEqual(["0s", "0s", "1s", "1m", "1m 1s", "59m 59s", "1h", "2h 5m"]);
	});

	it("labels completed and active run durations", () => {
		expect(runDurationLabel(completed, NOW)).toBe("4m 7s");
		expect(runDurationLabel(running, NOW)).toBe("2m");
		expect(runDurationLabel({ ...running, startedAt: null }, NOW)).toBeUndefined();
		expect(runDurationLabel({ ...running, status: "failed" }, NOW)).toBeUndefined();
	});

	it("describes when a run happened in words", () => {
		expect(formatRelativeTime("2026-03-13T09:01:50.000Z", NOW)).toBe("just now");
		expect(formatRelativeTime("2026-03-13T09:01:15.000Z", NOW)).toBe("1 minute ago");
		expect(formatRelativeTime("2026-03-13T09:00:00.000Z", NOW)).toBe("2 minutes ago");
		expect(formatRelativeTime("2026-03-13T08:00:00.000Z", NOW)).toBe("1 hour ago");
		expect(formatRelativeTime("2026-03-12T08:00:00.000Z", NOW)).toBe("yesterday");
		expect(formatRelativeTime("2026-03-11T08:00:00.000Z", NOW)).toBe("2 days ago");
		expect(formatRelativeTime("2026-02-01T08:00:00.000Z", NOW)).toBe("Feb 1, 2026");
	});

	it("uses the start time, or creation time when not started", () => {
		expect(runStartedLabel(running, NOW)).toBe("Started 2 minutes ago");
		expect(runStartedLabel({ ...running, startedAt: null }, NOW)).toBe("Started 2 minutes ago");
	});

	it("stamps the detail overline with the date and time of the run", () => {
		const value = "2026-03-12T21:40:00.000Z";
		const date = new Date(value);
		const day = new Intl.DateTimeFormat("en-GB", {
			day: "numeric",
			month: "short",
			year: "numeric",
		}).format(date);
		const time = new Intl.DateTimeFormat("en-GB", {
			hour12: false,
			hour: "2-digit",
			minute: "2-digit",
		}).format(date);

		expect(runTimestampLabel(value)).toBe(`${day}, ${time}`);
	});
});
