import type { BackupRunId } from "@ryot/contract/schema/brands";
import { Cause, Effect, Stream } from "effect";

import { appClient } from "./client";
import { prepareDownload, pruneDownloadCache, saveDownload } from "./files/save-download";
import type { ApiScope } from "./request-key";

const BACKUP_ARCHIVE_CONTENT_TYPE = "application/zip";

const BACKUP_DOWNLOAD_FAILURE_MESSAGE = "Could not download this backup. Try again.";

const backupFileName = (runId: BackupRunId) => `ryot-backup-${runId}.zip`;

export const downloadBackupArchive = (
	scope: ApiScope,
	runId: BackupRunId,
	target: ReturnType<typeof prepareDownload>,
) =>
	Effect.gen(function* () {
		const prepared = yield* Effect.promise(() => target);
		const client = yield* appClient(scope).request;
		const stream = yield* client.backups.downloadRun({ params: { id: runId } });
		return yield* Effect.promise(() =>
			saveDownload({
				target: prepared,
				fileName: backupFileName(runId),
				contentType: BACKUP_ARCHIVE_CONTENT_TYPE,
				chunks: Stream.toAsyncIterable(stream),
			}),
		);
	}).pipe(
		Effect.catchCause((cause) =>
			Effect.logWarning("backup archive download failed", Cause.pretty(cause)).pipe(
				Effect.as({ kind: "failed", message: BACKUP_DOWNLOAD_FAILURE_MESSAGE } as const),
			),
		),
	);

export const backupArchiveDownloadOperation = (scope: ApiScope) => (runId: BackupRunId) => {
	const target = prepareDownload({
		fileName: backupFileName(runId),
		contentType: BACKUP_ARCHIVE_CONTENT_TYPE,
	});
	return Effect.runPromise(downloadBackupArchive(scope, runId, target));
};

export const pruneBackupDownloadCache = pruneDownloadCache;
