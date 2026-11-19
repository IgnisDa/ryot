import { expect, it } from "bun:test";

import { BackupConflict } from "@ryot-app/contract/modules/backups/schemas";
import { testKernelText } from "@ryot-app/kernel-messages/testing";

import { backupRunFailureNotice } from "./presentation";
import { backupRestoreFailure } from "./restore-failure";

const renderedNotice = (...args: Parameters<typeof backupRunFailureNotice>) => {
	const { label, detail } = backupRunFailureNotice(...args);
	return { label: testKernelText(label), detail: testKernelText(detail) };
};

it.each(["entry-too-large", "total-size-exceeded", "entry-count-exceeded"] as const)(
	"presents %s as a safety limit rather than archive damage",
	(issue) => {
		expect(renderedNotice({ issue, code: "archive-invalid" })).toEqual<unknown>({
			label: "Backup limit reached",
			detail: "This backup exceeds a supported size or entry limit. No account data was changed.",
		});
	},
);

it("retains the damaged-archive notice for failed integrity checks", () => {
	expect(renderedNotice({ code: "archive-invalid", issue: "checksum-mismatch" })).toEqual<unknown>({
		label: "Archive damaged",
		detail:
			"This archive was damaged or incomplete, so nothing was changed. Download the backup again and retry.",
	});
});

it("explains that unpublished pages also prevent restore", () => {
	expect(renderedNotice({ category: "pages", code: "account-not-clean" })).toEqual<unknown>({
		label: "Account has pages",
		detail:
			"This account already had pages, including any unpublished drafts, so nothing was changed. Restore this backup into a new, empty account.",
	});
	const restore = backupRestoreFailure(
		new BackupConflict({ reason: { category: "pages", code: "account-not-clean" } }),
	);
	expect(restore.step).toBe("confirm");
	expect<string>(testKernelText(restore.detail)).toBe(
		"This account already has pages, including any unpublished drafts. Restore this backup into a new, empty account.",
	);
});
