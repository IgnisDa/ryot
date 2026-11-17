import { BackupConflict } from "@ryot-app/contract/modules/backups/schemas";
import type { Message } from "@ryot-app/i18n/message";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { Match } from "effect";

import { AuthenticatedApiError } from "#/api/authenticated";

export const BACKUP_RESTORE_STEPS = ["choose", "confirm"] as const;

export type BackupRestoreStep = (typeof BACKUP_RESTORE_STEPS)[number];

export type BackupRestoreFailure = {
	readonly detail: Message;
	readonly step: undefined | BackupRestoreStep;
};

const fallback = {
	step: undefined,
	detail: kernelMessage("client.backups.restore-failure.fallback"),
} as const;

const presentReason = (reason: BackupConflict["reason"]): BackupRestoreFailure =>
	Match.value(reason).pipe(
		Match.when({ category: "pages", code: "account-not-clean" }, () => ({
			step: "confirm" as const,
			detail: kernelMessage("client.backups.restore-failure.account-has-pages"),
		})),
		Match.when({ code: "account-not-clean" }, () => ({
			step: "confirm" as const,
			detail: kernelMessage("client.backups.restore-failure.account-not-empty"),
		})),
		Match.when({ code: "active-run-exists" }, () => fallback),
		Match.when({ code: "export-still-running" }, () => fallback),
		Match.when({ code: "run-still-active" }, () => fallback),
		Match.exhaustive,
	);

export const backupRestoreFailure = (error: unknown): BackupRestoreFailure => {
	const cause = error instanceof AuthenticatedApiError ? error.cause : error;
	return cause instanceof BackupConflict ? presentReason(cause.reason) : fallback;
};
