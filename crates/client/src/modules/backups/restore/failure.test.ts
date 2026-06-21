import { BackupConflict } from "@ryot-app/contract/modules/backups/schemas";
import { Cause } from "effect";
import { describe, expect, it } from "vitest";

import { backupRestoreFailure } from "./failure";

describe("backup restore failure", () => {
	it("keeps an account that already has data on the confirmation step", () => {
		const failure = backupRestoreFailure(
			Cause.fail(
				new BackupConflict({ reason: { code: "account-not-clean", category: "plugin-state" } }),
			),
		);

		expect(failure.step).toBe("confirm");
		expect(failure.detail).toBe(
			"This account already has data in it. A backup can only be restored into a new, empty account.",
		);
		expect(failure.detail).not.toContain("plugin-state");
	});

	it("does not claim to handle upload failures the create call never reports", () => {
		const expired = backupRestoreFailure(Cause.fail(new Error("upload unavailable")));

		expect(expired.step).toBeUndefined();
		expect(expired.detail).toBe("This restore could not be started. Try again.");
	});

	it("falls back to one plain sentence and stays where it is", () => {
		const unmapped = backupRestoreFailure(
			Cause.fail(new BackupConflict({ reason: { code: "active-run-exists" } })),
		);

		expect(unmapped).toEqual({
			step: undefined,
			detail: "This restore could not be started. Try again.",
		});
		expect(backupRestoreFailure(Cause.fail(new Error("unexpected")))).toEqual(unmapped);
	});
});
