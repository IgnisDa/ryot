import type { BackupRun, BackupRunKind } from "@ryot/contract/modules/backups/schemas";
import type { RunStatus } from "@ryot/contract/schema/run-status";
import { DateTime, Match } from "effect";

import {
	isTerminalRunStatus,
	percentRunProgress,
	type RunProgress,
	type RunProgressValue,
} from "@/modules/ui/run/run-status";

type BackupRunProgress = Pick<BackupRun, "status" | "progress">;

type BackupRunExpiry = Pick<BackupRun, "kind" | "status" | "expiresAt">;

export type BackupRunFailureNotice = {
	readonly label: string;
	readonly detail: string;
};

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const instant = (value: string) => DateTime.toEpochMillis(DateTime.makeUnsafe(value));

export const canDeleteBackupRun = (status: RunStatus) => status !== "running";

export const liveBackupRun = <Run extends Pick<BackupRun, "status">>(runs: readonly Run[]) =>
	runs.find((run) => !isTerminalRunStatus(run.status));

export const backupRunKindLabel = (kind: BackupRunKind) =>
	Match.value(kind).pipe(
		Match.when("export", () => "Backup"),
		Match.when("restore", () => "Restore"),
		Match.exhaustive,
	);

export const canDownloadBackupRun = (run: BackupRunExpiry, nowMs: number) =>
	run.kind === "export" &&
	run.status === "completed" &&
	run.expiresAt !== null &&
	instant(run.expiresAt) > nowMs;

export const backupRunProgress = (run: BackupRunProgress): RunProgress =>
	run.status === "pending"
		? { kind: "indeterminate", label: "Preparing" }
		: percentRunProgress(run.progress);

export const backupRunProgressValue = (run: BackupRunProgress): RunProgressValue => {
	const progress = backupRunProgress(run);
	return progress.kind === "indeterminate"
		? { text: "Preparing" }
		: { min: 0, max: 100, now: progress.percent, text: `${progress.percent}% done` };
};

/**
 * Forward-looking counterpart to `formatRelativeTime`, which reads in the past tense and cannot
 * describe an artifact that is still available for a while.
 */
export const backupExpiryLabel = (run: Pick<BackupRun, "expiresAt">, nowMs: number) => {
	if (run.expiresAt === null) {
		return undefined;
	}
	const remaining = instant(run.expiresAt) - nowMs;
	if (remaining <= 0) {
		return "Expired";
	}
	if (remaining < MINUTE_MS) {
		return "Expires in under a minute";
	}
	if (remaining < HOUR_MS) {
		const minutes = Math.round(remaining / MINUTE_MS);
		return minutes === 1 ? "Expires in 1 minute" : `Expires in ${minutes} minutes`;
	}
	if (remaining < DAY_MS) {
		const hours = Math.round(remaining / HOUR_MS);
		return hours === 1 ? "Expires in 1 hour" : `Expires in ${hours} hours`;
	}
	const days = Math.round(remaining / DAY_MS);
	return days === 1 ? "Expires in 1 day" : `Expires in ${days} days`;
};

export const backupRunFailureNotice = (error: string | null): BackupRunFailureNotice => {
	const summary = (error ?? "").toLowerCase();
	if (/not clean/.test(summary)) {
		return {
			label: "Account not empty",
			detail:
				"This account already had data in it, so nothing was changed. A backup can only be restored into a new, empty account.",
		};
	}
	if (/encrypt|compression|unsupported|not supported|format/.test(summary)) {
		return {
			label: "Archive unsupported",
			detail:
				"This archive uses a zip form Ryot cannot open. Upload the original file exactly as Ryot exported it.",
		};
	}
	if (/requires plugin|unavailable plugin/.test(summary)) {
		return {
			label: "Plugin missing",
			detail:
				"This backup needs a plugin that is not installed on this server. Install it, then restore again.",
		};
	}
	if (/could not be claimed|download object/.test(summary)) {
		return {
			label: "Upload expired",
			detail:
				"The file you uploaded was no longer on the server when this restore ran, so nothing was changed. Upload the backup again.",
		};
	}
	if (/checksum|truncat|invalid|malformed|missing/.test(summary)) {
		return {
			label: "Archive damaged",
			detail:
				"This archive was damaged or incomplete, so nothing was changed. Download the backup again and retry.",
		};
	}
	return {
		label: "Stopped early",
		detail: "This stopped before it finished. Nothing was left half-written.",
	};
};

export const backupRunOutcomeLabel = (run: BackupRun, nowMs: number) => {
	if (run.status === "failed") {
		return backupRunFailureNotice(run.error).label;
	}
	if (!isTerminalRunStatus(run.status)) {
		return backupRunProgress(run).label;
	}
	if (run.kind === "restore") {
		return "Restored";
	}
	return canDownloadBackupRun(run, nowMs) ? "Ready to download" : "No longer available";
};

export const backupRunDeleteConfirmation = (run: Pick<BackupRun, "kind">) =>
	run.kind === "export"
		? "This removes this record and the stored archive from your server. Nothing in your account is deleted, and any copy you already downloaded is untouched."
		: "This removes this record only. Nothing that was restored into your account is deleted.";
