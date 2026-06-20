import { describe, expect, it } from "vitest";

import { backupRun, NOW_MS } from "../backup-fixture";
import {
	backupExpiryLabel,
	backupRunDeleteConfirmation,
	backupRunFailureNotice,
	backupRunKindLabel,
	backupRunOutcomeLabel,
	backupRunProgress,
	backupRunProgressValue,
	canDeleteBackupRun,
	canDownloadBackupRun,
	liveBackupRun,
} from "./presentation";

const at = (offsetMs: number) => new Date(NOW_MS + offsetMs).toISOString();

describe("backup run presentation", () => {
	it("names both kinds of run in the user's words", () => {
		expect(backupRunKindLabel("export")).toBe("Backup");
		expect(backupRunKindLabel("restore")).toBe("Restore");
	});

	it("picks the first run that has not finished", () => {
		expect(liveBackupRun([backupRun()])).toBeUndefined();
		expect(liveBackupRun([backupRun({ status: "failed" })])).toBeUndefined();
		expect(
			liveBackupRun([backupRun(), backupRun({ id: "backup-run-2", status: "running" })])?.id,
		).toBe("backup-run-2");
		expect(liveBackupRun([backupRun({ status: "pending" })])?.status).toBe("pending");
	});

	it("allows deleting only after a run finishes", () => {
		expect(canDeleteBackupRun("pending")).toBe(false);
		expect(canDeleteBackupRun("running")).toBe(false);
		expect(canDeleteBackupRun("completed")).toBe(true);
		expect(canDeleteBackupRun("failed")).toBe(true);
	});

	it("offers a download only for a completed export whose link is still live", () => {
		expect(canDownloadBackupRun(backupRun(), NOW_MS)).toBe(true);
		expect(canDownloadBackupRun(backupRun({ expiresAt: at(-1) }), NOW_MS)).toBe(false);
		expect(canDownloadBackupRun(backupRun({ expiresAt: at(1_000) }), NOW_MS)).toBe(true);
		expect(canDownloadBackupRun(backupRun({ expiresAt: null }), NOW_MS)).toBe(false);
		expect(canDownloadBackupRun(backupRun({ status: "running" }), NOW_MS)).toBe(false);
		expect(canDownloadBackupRun(backupRun({ kind: "restore" }), NOW_MS)).toBe(false);
	});

	it("waits for real progress before showing a percentage", () => {
		expect(backupRunProgress(backupRun({ progress: 0, status: "pending" }))).toEqual({
			label: "Preparing",
			kind: "indeterminate",
		});
		expect(backupRunProgress(backupRun({ progress: 41, status: "running" }))).toEqual({
			percent: 41,
			label: "41%",
			kind: "determinate",
		});
		expect(backupRunProgressValue(backupRun({ status: "pending" }))).toEqual({
			text: "Preparing",
		});
		expect(backupRunProgressValue(backupRun({ progress: 41, status: "running" }))).toEqual({
			min: 0,
			max: 100,
			now: 41,
			text: "41% done",
		});
	});

	it("counts down to the moment a download stops working", () => {
		expect(backupExpiryLabel(backupRun({ expiresAt: null }), NOW_MS)).toBeUndefined();
		expect(backupExpiryLabel(backupRun({ expiresAt: at(-1) }), NOW_MS)).toBe("Expired");
		expect(backupExpiryLabel(backupRun({ expiresAt: at(0) }), NOW_MS)).toBe("Expired");
		expect(backupExpiryLabel(backupRun({ expiresAt: at(30_000) }), NOW_MS)).toBe(
			"Expires in under a minute",
		);
		expect(backupExpiryLabel(backupRun({ expiresAt: at(60_000) }), NOW_MS)).toBe(
			"Expires in 1 minute",
		);
		expect(backupExpiryLabel(backupRun({ expiresAt: at(40 * 60_000) }), NOW_MS)).toBe(
			"Expires in 40 minutes",
		);
		expect(backupExpiryLabel(backupRun({ expiresAt: at(22 * 3_600_000) }), NOW_MS)).toBe(
			"Expires in 22 hours",
		);
		expect(backupExpiryLabel(backupRun({ expiresAt: at(3_600_000) }), NOW_MS)).toBe(
			"Expires in 1 hour",
		);
		expect(backupExpiryLabel(backupRun({ expiresAt: at(36 * 3_600_000) }), NOW_MS)).toBe(
			"Expires in 2 days",
		);
	});

	it("explains each way a run can fail without repeating the server wording", () => {
		const damaged = backupRunFailureNotice({ code: "archive-invalid", issue: "checksum-mismatch" });
		const encrypted = backupRunFailureNotice({
			feature: "compression",
			code: "archive-unsupported",
		});
		const plugin = backupRunFailureNotice({
			pluginSlug: "media",
			requiredVersion: "1.2.0",
			code: "required-plugin-unavailable",
		});
		const unclean = backupRunFailureNotice({ code: "account-not-clean", category: "entities" });
		const unknown = backupRunFailureNotice({ code: "unexpected-failure", operation: "restore" });
		const expired = backupRunFailureNotice({ code: "upload-unavailable" });

		expect(damaged.label).toBe("Archive damaged");
		expect(encrypted.label).toBe("Archive unsupported");
		expect(plugin.label).toBe("Plugin missing");
		expect(plugin.detail).not.toContain("media");
		expect(unclean.label).toBe("Account not empty");
		expect(unclean.detail).not.toContain("entities");
		expect(unknown.label).toBe("Stopped early");
		expect(expired.label).toBe("Upload expired");
		expect(expired.detail).toContain("Upload the backup again");
		expect(backupRunFailureNotice(null).label).toBe("Stopped early");
	});

	it("summarises each row by what the user can do with it next", () => {
		expect(backupRunOutcomeLabel(backupRun(), NOW_MS)).toBe("Ready to download");
		expect(backupRunOutcomeLabel(backupRun({ expiresAt: at(-1) }), NOW_MS)).toBe(
			"No longer available",
		);
		expect(backupRunOutcomeLabel(backupRun({ kind: "restore" }), NOW_MS)).toBe("Restored");
		expect(backupRunOutcomeLabel(backupRun({ progress: 30, status: "running" }), NOW_MS)).toBe(
			"30%",
		);
		expect(backupRunOutcomeLabel(backupRun({ status: "pending" }), NOW_MS)).toBe("Preparing");
		expect(
			backupRunOutcomeLabel(
				backupRun({
					status: "failed",
					failure: { code: "archive-invalid", issue: "checksum-mismatch" },
				}),
				NOW_MS,
			),
		).toBe("Archive damaged");
	});

	it("promises that deleting a record never touches account data", () => {
		const exported = backupRunDeleteConfirmation(backupRun());
		const restored = backupRunDeleteConfirmation(backupRun({ kind: "restore" }));

		expect(exported).toContain("stored archive");
		expect(exported).toContain("Nothing in your account is deleted");
		expect(restored).toContain("Nothing that was restored into your account is deleted");
	});
});
