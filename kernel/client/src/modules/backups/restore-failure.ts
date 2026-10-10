import { BackupConflict } from "@ryot-app/contract/modules/backups/schemas";
import { Match } from "effect";

import { AuthenticatedApiError } from "#/api/authenticated";

export const BACKUP_RESTORE_STEPS = ["choose", "confirm"] as const;

export type BackupRestoreStep = (typeof BACKUP_RESTORE_STEPS)[number];

export type BackupRestoreFailure = {
	readonly detail: string;
	readonly step: BackupRestoreStep | undefined;
};

const fallback = {
	step: undefined,
	detail: "This restore could not be started. Try again.",
} as const;

const presentReason = (reason: BackupConflict["reason"]): BackupRestoreFailure =>
	Match.value(reason).pipe(
		Match.when({ code: "account-not-clean" }, () => ({
			step: "confirm" as const,
			detail:
				"This account already has data in it. A backup can only be restored into a new, empty account.",
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
