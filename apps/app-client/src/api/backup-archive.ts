import type { BackupRunId } from "@ryot/contract/schema/brands";

import { resolveApiUrl } from "./origin";

export const BACKUP_ARCHIVE_CONTENT_TYPE = "application/zip";

export const backupArchiveFileName = (runId: BackupRunId) => `ryot-backup-${runId}.zip`;

export const backupArchiveDownloadUrl = (serverUrl: string, runId: BackupRunId) =>
	resolveApiUrl(serverUrl, `backups/runs/${runId}/download`);
