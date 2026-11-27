import { calendarDaysBetween, localDateOf } from "@ryot-app/contract/modules/analytics/calendar";
import type { BackupRunStatus } from "@ryot-app/contract/modules/backups/schemas";
import type { ImportRunStatus } from "@ryot-app/contract/modules/imports/schemas";
import { deviceTimeZone } from "@ryot-app/contract/schema/time-zone";
import type { Formatters } from "@ryot-app/i18n/formatters";
import type { Message } from "@ryot-app/i18n/message";
import type { Text } from "@ryot-app/i18n/text";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { formatDuration } from "@ryot-app/plugin-ui-sdk";
import { formatDateLabel, formatDaysAgo } from "@ryot-app/plugin-ui-sdk/datetime";
import { DateTime } from "effect";

export type PresentedRunStatus = ImportRunStatus | BackupRunStatus;

export type RunStatusTone = "info" | "muted" | "danger" | "success";

export type RunProgressValue = {
	readonly text: string;
	readonly now?: number;
	readonly min?: number;
	readonly max?: number;
};

export type RunProgress =
	| { readonly label: string; readonly kind: "indeterminate" }
	| { readonly label: string; readonly percent: number; readonly kind: "determinate" };

type RunDuration = { readonly status: PresentedRunStatus } & Pick<
	RunTiming,
	"startedAt" | "finishedAt"
>;

/**
 * Structural rather than derived from one row type: manual import runs and integration runs both
 * feed these, and a run's timing is the only thing they are guaranteed to share.
 */
type RunTiming = {
	readonly createdAt: string;
	readonly startedAt: null | string;
	readonly finishedAt: null | string;
};

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const instant = (value: string) => DateTime.toEpochMillis(DateTime.makeUnsafe(value));

export const isTerminalRunStatus = (status: PresentedRunStatus) =>
	status === "completed" || status === "failed" || status === "cancelled" || status === "expired";

export const formatRunCount = (formatters: Formatters, value: number) =>
	formatters.number().format(Math.max(Math.round(value), 0));

const runStatusIcons = {
	pending: "clock",
	blocked: "clock",
	expired: "circle-x",
	cancelled: "circle-x",
	running: "rotate-ccw",
	failed: "circle-alert",
	cancelling: "rotate-ccw",
	completed: "circle-check",
} as const satisfies Record<PresentedRunStatus, string>;

const runStatusTones = {
	running: "info",
	pending: "muted",
	blocked: "muted",
	expired: "muted",
	failed: "danger",
	cancelled: "muted",
	cancelling: "info",
	completed: "success",
} as const satisfies Record<PresentedRunStatus, RunStatusTone>;

export const runStatusPill = (status: PresentedRunStatus) => ({
	icon: runStatusIcons[status],
	tone: runStatusTones[status],
	label: kernelMessage("client.ui.run.status", { status }),
});

/** A determinate bar for a 0–100 share, clamped to whole percents. */
export const determinateRunProgress = (formatters: Formatters, value: number): RunProgress => {
	const percent = Math.min(Math.max(Math.round(value), 0), 100);
	return {
		percent,
		kind: "determinate",
		label: formatters.number({ style: "percent" }).format(percent / 100),
	};
};

export const runDurationLabel = (formatters: Formatters, run: RunDuration, nowMs: number) => {
	if (run.startedAt === null || (run.finishedAt === null && isTerminalRunStatus(run.status))) {
		return undefined;
	}
	const endMs = run.finishedAt === null ? nowMs : instant(run.finishedAt);
	return formatDuration(formatters, Math.max(endMs - instant(run.startedAt), 0) / 1000);
};

export const formatRelativeTime = (
	formatters: Formatters,
	t: (message: Message) => Text,
	value: string,
	nowMs: number,
) => {
	const elapsed = nowMs - instant(value);
	const relative = formatters.relativeTime({ numeric: "auto" });
	if (elapsed < 45_000) {
		return t(kernelMessage("client.ui.run.just-now"));
	}
	if (elapsed < HOUR_MS) {
		return relative.format(-Math.round(elapsed / MINUTE_MS), "minute");
	}
	if (elapsed < DAY_MS) {
		return relative.format(-Math.round(elapsed / HOUR_MS), "hour");
	}
	const timeZone = deviceTimeZone();
	const days = calendarDaysBetween(localDateOf(value, timeZone), localDateOf(nowMs, timeZone));
	return days < 7 ? formatDaysAgo(formatters, days) : formatDateLabel(formatters, value);
};

/** When a history row's run started and, once it has a duration, how long it ran. */
export const runHistoryCaption = (
	formatters: Formatters,
	t: (message: Message) => Text,
	run: RunDuration & Pick<RunTiming, "createdAt">,
	nowMs: number,
) => {
	const relative = formatRelativeTime(formatters, t, run.createdAt, nowMs);
	const duration = runDurationLabel(formatters, run, nowMs);
	return duration === undefined
		? relative
		: t(kernelMessage("client.ui.run.history-caption", { duration, relative }));
};

export const runStartedLabel = (
	formatters: Formatters,
	t: (message: Message) => Text,
	run: Pick<RunTiming, "createdAt" | "startedAt">,
	nowMs: number,
) =>
	t(
		kernelMessage("client.ui.run.started", {
			when: formatRelativeTime(formatters, t, run.startedAt ?? run.createdAt, nowMs),
		}),
	);

export const runTimestampLabel = (formatters: Formatters, value: string) =>
	formatters
		.dateTime({
			day: "numeric",
			month: "short",
			year: "numeric",
			hour: "2-digit",
			hourCycle: "h23",
			minute: "2-digit",
		})
		.format(new Date(value));
