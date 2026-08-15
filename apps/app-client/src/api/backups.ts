import type { BackupRunId } from "@ryot/contract/schema/brands";
import { Cause, Effect } from "effect";

import { getAuthCookie } from "@/modules/auth/storage";

import {
	BACKUP_ARCHIVE_CONTENT_TYPE,
	backupArchiveDownloadUrl,
	backupArchiveFileName,
} from "./backup-archive";
import { pruneDownloadCache, saveDownload } from "./files/save-download";
import type { ApiScope } from "./request-key";

const BACKUP_DOWNLOAD_FAILURE_MESSAGE = "Could not download this backup. Try again.";

export const downloadBackupArchive = (scope: ApiScope, runId: BackupRunId) =>
	Effect.tryPromise(() =>
		saveDownload({
			fileName: backupArchiveFileName(runId),
			contentType: BACKUP_ARCHIVE_CONTENT_TYPE,
			url: backupArchiveDownloadUrl(scope.serverUrl, runId),
			headers: async (): Promise<Record<string, string>> => {
				const cookie = await getAuthCookie(scope.serverUrl);
				return cookie === undefined ? {} : { Cookie: cookie };
			},
		}),
	).pipe(
		Effect.catchCause((cause) =>
			Effect.logWarning("backup archive download failed", Cause.pretty(cause)).pipe(
				Effect.as({ kind: "failed", message: BACKUP_DOWNLOAD_FAILURE_MESSAGE } as const),
			),
		),
	);

export const backupArchiveDownloadOperation = (scope: ApiScope) => (runId: BackupRunId) =>
	Effect.runPromise(downloadBackupArchive(scope, runId));

export const pruneBackupDownloadCache = pruneDownloadCache;
