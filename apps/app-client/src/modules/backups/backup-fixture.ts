import type { BackupRun, ListRunsResponse } from "@ryot/contract/modules/backups/schemas";
import { BackupRunId } from "@ryot/contract/schema/brands";

export const NOW_MS = Date.parse("2026-03-13T12:00:00.000Z");

const baseRun: BackupRun = {
	error: null,
	progress: 100,
	kind: "export",
	status: "completed",
	artifactProvider: "local",
	createdAt: "2026-03-13T11:00:00.000Z",
	startedAt: "2026-03-13T11:00:02.000Z",
	expiresAt: "2026-03-14T11:00:00.000Z",
	finishedAt: "2026-03-13T11:01:40.000Z",
	id: BackupRunId.make("backup-run-1"),
};

type BackupRunOverrides = Omit<Partial<BackupRun>, "id"> & { readonly id?: string };

export const backupRun = (overrides: BackupRunOverrides = {}): BackupRun => ({
	...baseRun,
	...overrides,
	id: overrides.id === undefined ? baseRun.id : BackupRunId.make(overrides.id),
});

export const backupRunList = (runs: readonly BackupRun[] = [baseRun]): ListRunsResponse => ({
	items: runs,
});
