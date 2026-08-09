import type { BackupRunId } from "@ryot/contract/schema/brands";
import { Cause, Effect, Stream } from "effect";

import { appClient } from "./client";
import type { ApiScope } from "./request-key";
import { saveDownload } from "./save-download";

const BACKUP_ARCHIVE_CONTENT_TYPE = "application/zip";

const BACKUP_DOWNLOAD_FAILURE_MESSAGE = "Could not download this backup. Try again.";

// The archive is buffered in memory so both platforms share one network path. Personal
// archives stay far below the temporary-upload ZIP ceiling this trade is bounded by.
export const downloadBackupArchive = (scope: ApiScope, runId: BackupRunId) =>
	Effect.gen(function* () {
		const client = yield* appClient(scope).request;
		const stream = yield* client.backups.downloadRun({ params: { id: runId } });
		const chunks = yield* Stream.runCollect(stream);
		return yield* Effect.promise(() =>
			saveDownload({
				chunks,
				fileName: `ryot-backup-${runId}.zip`,
				contentType: BACKUP_ARCHIVE_CONTENT_TYPE,
			}),
		);
	}).pipe(
		Effect.catchCause((cause) =>
			Effect.logWarning("backup archive download failed", Cause.pretty(cause)).pipe(
				Effect.as({ kind: "failed", message: BACKUP_DOWNLOAD_FAILURE_MESSAGE } as const),
			),
		),
	);

export const backupArchiveDownloadOperation = (scope: ApiScope) => (runId: BackupRunId) =>
	Effect.runPromise(downloadBackupArchive(scope, runId));
