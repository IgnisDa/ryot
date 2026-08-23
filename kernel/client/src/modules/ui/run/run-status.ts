import type { RunStatus } from "@ryot-app/contract/schema/run-status";
import { DateTime, Match } from "effect";

/**
 * Structural rather than derived from one row type: manual import runs and integration runs both
 * feed these, and a run's timing is the only thing they are guaranteed to share.
 */
type RunTiming = {
	readonly createdAt: string;
	readonly startedAt: string | null;
	readonly finishedAt: string | null;
};

type RunDuration = Pick<RunTiming, "startedAt" | "finishedAt"> & { readonly status: RunStatus };

export type RunStatusTone = "info" | "muted" | "danger" | "success";

export type RunProgress =
	| { readonly kind: "indeterminate"; readonly label: string }
	| { readonly kind: "determinate"; readonly label: string; readonly percent: number };

export type RunProgressValue = {
	readonly text: string;
	readonly now?: number;
	readonly min?: number;
	readonly max?: number;
};

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const instant = (value: string) => DateTime.toEpochMillis(DateTime.makeUnsafe(value));

const formatDateLabel = (value: string) =>
	DateTime.formatLocal(DateTime.makeUnsafe(value), {
		day: "numeric",
		month: "short",
		year: "numeric",
		locale: "en-US",
	});

export const isTerminalRunStatus = (status: RunStatus) =>
	status === "completed" || status === "failed";

export const formatRunCount = (value: number) =>
	Math.max(Math.round(value), 0).toLocaleString("en-US");

export const runStatusPill = (status: RunStatus) =>
	Match.value(status).pipe(
		Match.when("pending", () => ({ icon: "clock", tone: "muted", label: "Queued" }) as const),
		Match.when("running", () => ({ tone: "info", label: "Running", icon: "rotate-ccw" }) as const),
		Match.when(
			"completed",
			() => ({ tone: "success", label: "Completed", icon: "circle-check" }) as const,
		),
		Match.when(
			"failed",
			() => ({ tone: "danger", label: "Failed", icon: "circle-alert" }) as const,
		),
		Match.exhaustive,
	);

export const formatRunDuration = (milliseconds: number) => {
	const seconds = Math.max(Math.round(milliseconds / 1000), 0);
	if (seconds < 60) {
		return `${seconds}s`;
	}
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) {
		const rest = seconds % 60;
		return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`;
	}
	const hours = Math.floor(minutes / 60);
	const rest = minutes % 60;
	return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
};

export const runDurationLabel = (run: RunDuration, nowMs: number) => {
	if (run.startedAt === null) {
		return undefined;
	}
	const startedAt = instant(run.startedAt);
	if (run.finishedAt !== null) {
		return formatRunDuration(instant(run.finishedAt) - startedAt);
	}
	return isTerminalRunStatus(run.status) ? undefined : formatRunDuration(nowMs - startedAt);
};

export const formatRelativeTime = (value: string, nowMs: number) => {
	const elapsed = nowMs - instant(value);
	if (elapsed < 45_000) {
		return "just now";
	}
	if (elapsed < HOUR_MS) {
		const minutes = Math.round(elapsed / MINUTE_MS);
		return minutes === 1 ? "1 minute ago" : `${minutes} minutes ago`;
	}
	if (elapsed < DAY_MS) {
		const hours = Math.round(elapsed / HOUR_MS);
		return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
	}
	const days = Math.floor(elapsed / DAY_MS);
	if (days === 1) {
		return "yesterday";
	}
	return days < 7 ? `${days} days ago` : formatDateLabel(value);
};

export const runStartedLabel = (run: Pick<RunTiming, "createdAt" | "startedAt">, nowMs: number) =>
	`Started ${formatRelativeTime(run.startedAt ?? run.createdAt, nowMs)}`;

export const runTimestampLabel = (value: string) => {
	const stamp = DateTime.makeUnsafe(value);
	const day = DateTime.formatLocal(stamp, {
		day: "numeric",
		month: "short",
		year: "numeric",
		locale: "en-GB",
	});
	const time = DateTime.formatLocal(stamp, {
		hour12: false,
		hour: "2-digit",
		locale: "en-GB",
		minute: "2-digit",
	});
	return `${day}, ${time}`;
};
