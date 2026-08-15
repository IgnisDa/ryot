import {
	type RequestFailureRule,
	resolveRequestFailure,
	type ResolvedRequestFailure,
} from "@/api/request-failure";

export const BACKUP_RESTORE_STEPS = ["choose", "confirm"] as const;

export type BackupRestoreStep = (typeof BACKUP_RESTORE_STEPS)[number];

export type BackupRestoreFailure = ResolvedRequestFailure<BackupRestoreStep>;

const FALLBACK_DETAIL = "This restore could not be started. Try again.";

const restoreFailureRules: readonly RequestFailureRule<BackupRestoreStep>[] = [
	{
		step: "confirm",
		matches: (message) => message.includes("Account is not clean"),
		detail:
			"This account already has data in it. A backup can only be restored into a new, empty account.",
	},
];

export const backupRestoreFailure = (message: string | undefined) =>
	resolveRequestFailure(restoreFailureRules, message, FALLBACK_DETAIL);
