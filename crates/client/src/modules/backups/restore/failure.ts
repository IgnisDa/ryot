import { BackupConflict } from "@ryot-app/contract/modules/backups/schemas";
import type { Cause } from "effect";
import { Match } from "effect";

import { requestFailureError } from "@/api/request-failure";

export const BACKUP_RESTORE_STEPS = ["choose", "confirm"] as const;

export type BackupRestoreStep = (typeof BACKUP_RESTORE_STEPS)[number];

export type BackupRestoreFailure = {
	readonly detail: string;
	readonly step: BackupRestoreStep | undefined;
};

const FALLBACK_DETAIL = "This restore could not be started. Try again.";

const fallback = { step: undefined, detail: FALLBACK_DETAIL } as const;

export const backupRestoreFailure = (cause: Cause.Cause<unknown>): BackupRestoreFailure => {
	const error = requestFailureError(
		cause,
		(value): value is BackupConflict => value instanceof BackupConflict,
	);
	if (error === undefined) {
		return fallback;
	}
	return Match.value(error.reason).pipe(
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
};
