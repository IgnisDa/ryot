import { expect, it } from "bun:test";

import { BackupConflict } from "@ryot-app/contract/modules/backups/schemas";

import { backupRunFailureNotice } from "./presentation";
import { backupRestoreFailure } from "./restore-failure";

it.each(["entry-too-large", "total-size-exceeded", "entry-count-exceeded"] as const)(
	"presents %s as a safety limit rather than archive damage",
	(issue) => {
		expect(backupRunFailureNotice({ issue, code: "archive-invalid" })).toEqual({
			label: "Backup limit reached",
			detail: "This backup exceeds a supported size or entry limit. No account data was changed.",
		});
	},
);

it("retains the damaged-archive notice for failed integrity checks", () => {
	expect(backupRunFailureNotice({ code: "archive-invalid", issue: "checksum-mismatch" })).toEqual({
		label: "Archive damaged",
		detail:
			"This archive was damaged or incomplete, so nothing was changed. Download the backup again and retry.",
	});
});

it("explains that unpublished pages also prevent restore", () => {
	expect(backupRunFailureNotice({ category: "pages", code: "account-not-clean" })).toEqual({
		label: "Account has pages",
		detail:
			"This account already had pages, including any unpublished drafts, so nothing was changed. Restore this backup into a new, empty account.",
	});
	expect(
		backupRestoreFailure(
			new BackupConflict({ reason: { category: "pages", code: "account-not-clean" } }),
		),
	).toEqual({
		step: "confirm",
		detail:
			"This account already has pages, including any unpublished drafts. Restore this backup into a new, empty account.",
	});
});
