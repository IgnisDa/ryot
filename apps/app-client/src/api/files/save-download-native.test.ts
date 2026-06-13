import { describe, expect, it } from "vitest";

import { saveNativeDownload, shouldPruneTransferDirectory } from "./save-download-native";

const input = {
	fileName: "backup.zip",
	contentType: "application/zip",
	url: "https://ryot.test/api/backups/runs/run_1/download",
	headers: () => Promise.resolve({ Cookie: "session=abc" }),
};

describe("native download saving", () => {
	it("downloads with the resolved headers and shares the file", async () => {
		const events: unknown[] = [];
		const outcome = await saveNativeDownload(input, {
			discard: () => events.push("discarded"),
			sharingAvailable: () => Promise.resolve(true),
			share: () => {
				events.push("shared");
				return Promise.resolve();
			},
			download: (headers) => {
				events.push(headers);
				return Promise.resolve();
			},
		});

		expect(outcome).toEqual({ kind: "saved" });
		expect(events).toEqual([{ Cookie: "session=abc" }, "shared"]);
	});

	it("discards the transfer and fails when sharing is unavailable", async () => {
		const events: string[] = [];
		const outcome = await saveNativeDownload(input, {
			discard: () => events.push("discarded"),
			sharingAvailable: () => Promise.resolve(false),
			download: () => {
				events.push("downloaded");
				return Promise.resolve();
			},
			share: () => {
				events.push("shared");
				return Promise.resolve();
			},
		});

		expect(outcome).toEqual({
			kind: "failed",
			message: "Saving files is not supported on this device.",
		});
		expect(events).toEqual(["downloaded", "discarded"]);
	});

	it("discards the transfer and rethrows when the download fails", async () => {
		const events: string[] = [];

		await expect(
			saveNativeDownload(input, {
				share: () => Promise.resolve(),
				discard: () => events.push("discarded"),
				sharingAvailable: () => Promise.resolve(true),
				download: () => Promise.reject(new Error("network lost")),
			}),
		).rejects.toThrow("network lost");
		expect(events).toEqual(["discarded"]);
	});

	it("prunes only stale Ryot transfer directories", () => {
		const activeUris = new Set(["cache/active"]);
		expect(
			shouldPruneTransferDirectory({
				activeUris,
				uri: "cache/old",
				prefix: "ryot-backup-transfer-",
				name: "ryot-backup-transfer-old",
			}),
		).toBe(true);
		expect(
			shouldPruneTransferDirectory({
				activeUris,
				uri: "cache/active",
				prefix: "ryot-backup-transfer-",
				name: "ryot-backup-transfer-active",
			}),
		).toBe(false);
		expect(
			shouldPruneTransferDirectory({
				activeUris,
				uri: "cache/other",
				name: "other-app-file",
				prefix: "ryot-backup-transfer-",
			}),
		).toBe(false);
	});
});
