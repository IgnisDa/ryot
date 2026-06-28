import { BackupRunId } from "@ryot-app/contract/schema/brands";
import { Effect } from "effect";

import { requirePresent } from "~/support/assertions";
import { getApiUrl } from "~/support/harness-target";

import type { Client } from "./auth";
import { pollUntil } from "./polling";
import { uploadTemporaryArchive } from "./temporary-archive";

export const pollBackupRunUntilTerminal = (client: Client, runId: string) =>
	pollUntil(
		`Backup run '${runId}' to complete`,
		Effect.gen(function* () {
			const run = yield* client.call((c) =>
				c.backups.getRun({ params: { id: BackupRunId.make(runId) } }),
			);
			return run.status === "completed" || run.status === "failed" ? run : null;
		}),
	);

export const startBackupExport = (client: Client) =>
	Effect.gen(function* () {
		const result = yield* client.call((c) => c.backups.createExport());
		return requirePresent(result.id, "Backup export run id is missing");
	});

export const downloadBackupArchive = (token: string, runId: string) =>
	Effect.gen(function* () {
		const response = yield* Effect.promise(() =>
			fetch(`${getApiUrl()}/backups/runs/${runId}/download`, {
				headers: { Authorization: `Bearer ${token}` },
			}),
		);
		if (response.status !== 200) {
			throw new Error(`Could not download backup archive (${response.status})`);
		}

		const contentType = response.headers
			.get("content-type")
			?.split(";", 1)[0]
			?.trim()
			.toLowerCase();
		if (contentType !== "application/zip") {
			throw new Error(`Backup archive has invalid content type '${contentType ?? "missing"}'`);
		}

		const contentDisposition = response.headers.get("content-disposition");
		if (!contentDisposition || !/^attachment(?:;|$)/i.test(contentDisposition.trim())) {
			throw new Error("Backup archive is missing an attachment content disposition");
		}

		const bytes = new Uint8Array(yield* Effect.promise(() => response.arrayBuffer()));
		return { bytes, headers: response.headers };
	});

export const exportAndDownloadBackup = (client: Client, token: string) =>
	Effect.gen(function* () {
		const id = yield* startBackupExport(client);
		const run = yield* pollBackupRunUntilTerminal(client, id);
		if (run.status !== "completed") {
			throw new Error(`Backup export '${id}' failed with ${run.failure?.code ?? "unknown"}`);
		}

		const { bytes } = yield* downloadBackupArchive(token, id);
		return { id, run, bytes };
	});

export const restoreBackup = (client: Client, bytes: Uint8Array) =>
	Effect.gen(function* () {
		const uploadToken = yield* uploadTemporaryArchive(client, bytes, { fileName: "backup.zip" });
		const result = yield* client.call((c) => c.backups.createRestore({ payload: { uploadToken } }));
		const id = requirePresent(result.id, "Backup restore run id is missing");
		const run = yield* pollBackupRunUntilTerminal(client, id);
		return { id, run };
	});
