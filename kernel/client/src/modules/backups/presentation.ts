import type {
	BackupRunFailure,
	BackupRunKind,
	BackupRunStatus,
} from "@ryot-app/contract/modules/backups/schemas";
import type { Formatters } from "@ryot-app/i18n/formatters";
import type { Message } from "@ryot-app/i18n/message";
import type { Text } from "@ryot-app/i18n/text";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import type { BackupRunItem } from "@ryot-app/ryotql-recipes/backups";
import { DateTime, Match } from "effect";

import {
	determinateRunProgress,
	isTerminalRunStatus,
	type RunProgress,
	type RunProgressValue,
} from "#/modules/ui/run/run-status";

type Translate = (message: Message) => Text;

type BackupRunProgress = Pick<BackupRunItem, "status" | "progress">;

type BackupRunExpiry = Pick<BackupRunItem, "kind" | "status" | "expiresAt">;

type BackupRunFailureNotice = { readonly label: Message; readonly detail: Message };

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const instant = (value: string) => DateTime.toEpochMillis(DateTime.makeUnsafe(value));

export const canDeleteBackupRun = (status: BackupRunStatus) => isTerminalRunStatus(status);

export const liveBackupRun = <Run extends Pick<BackupRunItem, "status">>(runs: readonly Run[]) =>
	runs.find((run) => !isTerminalRunStatus(run.status));

export const backupRunKindLabel = (kind: BackupRunKind) =>
	Match.value(kind).pipe(
		Match.when("export", () => kernelMessage("client.backups.kind.export")),
		Match.when("restore", () => kernelMessage("client.backups.kind.restore")),
		Match.exhaustive,
	);

export const canDownloadBackupRun = (run: BackupRunExpiry, nowMs: number) =>
	run.kind === "export" &&
	run.status === "completed" &&
	run.expiresAt !== null &&
	instant(run.expiresAt) > nowMs;

export const backupRunProgress = (
	t: Translate,
	formatters: Formatters,
	run: BackupRunProgress,
): RunProgress =>
	run.status === "pending"
		? { kind: "indeterminate", label: t(kernelMessage("client.backups.preparing")) }
		: determinateRunProgress(formatters, run.progress);

export const backupRunProgressValue = (
	t: Translate,
	formatters: Formatters,
	run: BackupRunProgress,
): RunProgressValue => {
	const progress = backupRunProgress(t, formatters, run);
	return progress.kind === "indeterminate"
		? { text: progress.label }
		: {
				min: 0,
				max: 100,
				now: progress.percent,
				text: t(
					kernelMessage("client.backups.progress-done", { fraction: progress.percent / 100 }),
				),
			};
};

export const backupExpiryLabel = (
	run: Pick<BackupRunItem, "expiresAt">,
	nowMs: number,
): Message | undefined => {
	if (run.expiresAt === null) {
		return undefined;
	}
	const remaining = instant(run.expiresAt) - nowMs;
	if (remaining <= 0) {
		return kernelMessage("client.backups.expiry.expired");
	}
	if (remaining < MINUTE_MS) {
		return kernelMessage("client.backups.expiry.under-a-minute");
	}
	if (remaining < HOUR_MS) {
		return kernelMessage("client.backups.expiry.minutes", {
			count: Math.round(remaining / MINUTE_MS),
		});
	}
	if (remaining < DAY_MS) {
		return kernelMessage("client.backups.expiry.hours", { count: Math.round(remaining / HOUR_MS) });
	}
	return kernelMessage("client.backups.expiry.days", { count: Math.round(remaining / DAY_MS) });
};

const stoppedEarly = {
	label: kernelMessage("client.backups.failure.stopped-early.label"),
	detail: kernelMessage("client.backups.failure.stopped-early.detail"),
} as const;

export const backupRunFailureNotice = (failure: null | BackupRunFailure): BackupRunFailureNotice =>
	failure === null
		? stoppedEarly
		: Match.value(failure).pipe(
				Match.when({ category: "pages", code: "account-not-clean" }, () => ({
					label: kernelMessage("client.backups.failure.account-has-pages.label"),
					detail: kernelMessage("client.backups.failure.account-has-pages.detail"),
				})),
				Match.when({ code: "account-not-clean" }, () => ({
					label: kernelMessage("client.backups.failure.account-not-empty.label"),
					detail: kernelMessage("client.backups.failure.account-not-empty.detail"),
				})),
				Match.when({ code: "archive-unsupported" }, () => ({
					label: kernelMessage("client.backups.failure.archive-unsupported.label"),
					detail: kernelMessage("client.backups.failure.archive-unsupported.detail"),
				})),
				Match.when({ code: "required-plugin-unavailable" }, () => ({
					label: kernelMessage("client.backups.failure.plugin-missing.label"),
					detail: kernelMessage("client.backups.failure.plugin-missing.detail"),
				})),
				Match.when({ code: "upload-unavailable" }, () => ({
					label: kernelMessage("client.backups.failure.upload-expired.label"),
					detail: kernelMessage("client.backups.failure.upload-expired.detail"),
				})),
				Match.when({ code: "archive-invalid" }, ({ issue, maxCount }) =>
					issue === "entry-too-large" ||
					maxCount !== undefined ||
					issue === "total-size-exceeded" ||
					issue === "entry-count-exceeded"
						? {
								label: kernelMessage("client.backups.failure.limit-reached.label"),
								detail: kernelMessage("client.backups.failure.limit-reached.detail"),
							}
						: {
								label: kernelMessage("client.backups.failure.archive-damaged.label"),
								detail: kernelMessage("client.backups.failure.archive-damaged.detail"),
							},
				),
				Match.when({ code: "unexpected-failure" }, () => stoppedEarly),
				Match.exhaustive,
			);

export const backupRunOutcomeLabel = (
	t: Translate,
	formatters: Formatters,
	run: BackupRunItem,
	nowMs: number,
) => {
	if (run.status === "failed") {
		return t(backupRunFailureNotice(run.failure).label);
	}
	if (!isTerminalRunStatus(run.status)) {
		return backupRunProgress(t, formatters, run).label;
	}
	if (run.kind === "restore") {
		return t(kernelMessage("client.backups.outcome.restored"));
	}
	return t(
		kernelMessage(
			canDownloadBackupRun(run, nowMs)
				? "client.backups.outcome.ready-to-download"
				: "client.backups.outcome.unavailable",
		),
	);
};

export const backupRunDeleteConfirmation = (run: Pick<BackupRunItem, "kind">) =>
	kernelMessage(
		run.kind === "export"
			? "client.backups.delete-confirmation.export"
			: "client.backups.delete-confirmation.restore",
	);
