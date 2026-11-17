import { describe, expect, it } from "bun:test";

import { testFormatters, testKernelText } from "@ryot-app/kernel-messages/testing";

import {
	determinateRunProgress,
	formatRelativeTime,
	formatRunCount,
	isTerminalRunStatus,
	runDurationLabel,
	runHistoryCaption,
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
		expect(
			(["pending", "blocked", "running", "cancelling"] as const).map(isTerminalRunStatus),
		).toEqual([false, false, false, false]);
		expect(
			(["completed", "failed", "cancelled", "expired"] as const).map(isTerminalRunStatus),
		).toEqual([true, true, true, true]);
	});

	it("clamps and rounds run counts", () => {
		expect(formatRunCount(testFormatters, 42.4)).toBe("42");
		expect(formatRunCount(testFormatters, 42.5)).toBe("43");
		expect(formatRunCount(testFormatters, -5)).toBe("0");
		expect(formatRunCount(testFormatters, 1_234.5)).toBe("1,235");
	});

	it("maps every run status to its pill", () => {
		expect<ReadonlyArray<{ icon: string; tone: string; label: string }>>(
			(
				[
					"pending",
					"blocked",
					"expired",
					"running",
					"cancelling",
					"completed",
					"failed",
					"cancelled",
				] as const
			)
				.map(runStatusPill)
				.map((pill) => ({ icon: pill.icon, tone: pill.tone, label: testKernelText(pill.label) })),
		).toEqual([
			{ icon: "clock", tone: "muted", label: "Queued" },
			{ icon: "clock", tone: "muted", label: "Setup required" },
			{ tone: "muted", icon: "circle-x", label: "Expired" },
			{ tone: "info", label: "Running", icon: "rotate-ccw" },
			{ tone: "info", icon: "rotate-ccw", label: "Cancelling" },
			{ tone: "success", label: "Completed", icon: "circle-check" },
			{ tone: "danger", label: "Failed", icon: "circle-alert" },
			{ tone: "muted", icon: "circle-x", label: "Cancelled" },
		]);
	});

	it("clamps determinate progress to whole percents", () => {
		expect([-3, 42.4, 140].map((value) => determinateRunProgress(testFormatters, value))).toEqual([
			{ percent: 0, label: "0%", kind: "determinate" },
			{ percent: 42, label: "42%", kind: "determinate" },
			{ percent: 100, label: "100%", kind: "determinate" },
		]);
	});

	it("labels completed and active run durations", () => {
		expect<string | undefined>(runDurationLabel(testFormatters, completed, NOW)).toBe("4m 7s");
		expect<string | undefined>(runDurationLabel(testFormatters, running, NOW)).toBe("2m");
		expect<string | undefined>(
			runDurationLabel(testFormatters, { ...running, startedAt: null }, NOW),
		).toBeUndefined();
		expect<string | undefined>(
			runDurationLabel(testFormatters, { ...running, status: "failed" }, NOW),
		).toBeUndefined();
		expect<string | undefined>(
			runDurationLabel(testFormatters, { ...running, status: "expired" }, NOW),
		).toBeUndefined();
	});

	it("describes when a run happened in words", () => {
		expect<string>(
			formatRelativeTime(testFormatters, testKernelText, "2026-03-13T09:01:50.000Z", NOW),
		).toBe("just now");
		expect<string>(
			formatRelativeTime(testFormatters, testKernelText, "2026-03-13T09:01:15.000Z", NOW),
		).toBe("1 minute ago");
		expect<string>(
			formatRelativeTime(testFormatters, testKernelText, "2026-03-13T09:00:00.000Z", NOW),
		).toBe("2 minutes ago");
		expect<string>(
			formatRelativeTime(testFormatters, testKernelText, "2026-03-13T08:00:00.000Z", NOW),
		).toBe("1 hour ago");
		expect<string>(
			formatRelativeTime(testFormatters, testKernelText, "2026-03-12T08:00:00.000Z", NOW),
		).toBe("yesterday");
		expect<string>(
			formatRelativeTime(testFormatters, testKernelText, "2026-03-11T08:00:00.000Z", NOW),
		).toBe("2 days ago");
		expect<string>(
			formatRelativeTime(testFormatters, testKernelText, "2026-02-01T08:00:00.000Z", NOW),
		).toBe("Feb 1, 2026");
	});

	it("captions history rows with when they started and how long they ran", () => {
		expect<string>(
			runHistoryCaption(
				testFormatters,
				testKernelText,
				{ ...completed, createdAt: completed.startedAt },
				NOW,
			),
		).toBe("11 hours ago · 4m 7s");
		expect<string>(
			runHistoryCaption(testFormatters, testKernelText, { ...running, startedAt: null }, NOW),
		).toBe("2 minutes ago");
	});

	it("uses the start time, or creation time when not started", () => {
		expect<string>(runStartedLabel(testFormatters, testKernelText, running, NOW)).toBe(
			"Started 2 minutes ago",
		);
		expect<string>(
			runStartedLabel(testFormatters, testKernelText, { ...running, startedAt: null }, NOW),
		).toBe("Started 2 minutes ago");
	});

	it("stamps the detail overline with the date and time of the run", () => {
		const value = "2026-03-12T21:40:00.000Z";
		const expected = testFormatters
			.dateTime({
				day: "numeric",
				month: "short",
				year: "numeric",
				hour: "2-digit",
				hourCycle: "h23",
				minute: "2-digit",
			})
			.format(new Date(value));

		expect(runTimestampLabel(testFormatters, value)).toBe(expected);
	});
});
