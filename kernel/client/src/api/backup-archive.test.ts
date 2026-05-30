import { BackupRunId } from "@ryot/contract/schema/brands";
import { describe, expect, it } from "vitest";

import { backupArchiveDownloadUrl, backupArchiveFileName } from "./backup-archive";

const runId = BackupRunId.make("backup-run-1");

describe("backup archive addressing", () => {
	it("names the archive after the run", () => {
		expect(backupArchiveFileName(runId)).toBe("ryot-backup-backup-run-1.zip");
	});

	it("resolves the download endpoint under the server api origin", () => {
		expect(backupArchiveDownloadUrl("https://ryot.test", runId)).toBe(
			"https://ryot.test/api/backups/runs/backup-run-1/download",
		);
	});

	it("tolerates a server url with trailing slashes", () => {
		expect(backupArchiveDownloadUrl("https://ryot.test/", runId)).toBe(
			"https://ryot.test/api/backups/runs/backup-run-1/download",
		);
	});
});
