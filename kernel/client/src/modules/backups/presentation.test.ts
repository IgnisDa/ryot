import { expect, it } from "bun:test";

import { backupRunFailureNotice } from "./presentation";

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
