import { describe, expect, it } from "vitest";

import { saveNativeDownload, shouldPruneTransferDirectory } from "./save-download-native";

const chunks = async function* (...values: number[][]) {
	await Promise.resolve();
	for (const value of values) {
		yield new Uint8Array(value);
	}
};

const failingChunks = async function* () {
	await Promise.resolve();
	yield new Uint8Array([1]);
	throw new Error("network lost");
};

const input = (body: AsyncIterable<Uint8Array>) => ({
	chunks: body,
	fileName: "backup.zip",
	contentType: "application/zip",
	target: { kind: "native" } as const,
});

describe("native download saving", () => {
	it("writes response chunks directly, closes the handle, and shares the file", async () => {
		const events: unknown[] = [];
		const outcome = await saveNativeDownload(input(chunks([1, 2], [3])), {
			discard: () => events.push("discarded"),
			sharingAvailable: () => Promise.resolve(true),
			share: () => {
				events.push("shared");
				return Promise.resolve();
			},
			open: () => ({
				write: (chunk) => events.push([...chunk]),
				close: () => events.push("closed"),
			}),
		});

		expect(outcome).toEqual({ kind: "saved" });
		expect(events).toEqual([[1, 2], [3], "closed", "shared"]);
	});

	it("closes the handle and deletes a partial file when streaming fails", async () => {
		const events: string[] = [];

		await expect(
			saveNativeDownload(input(failingChunks()), {
				share: () => Promise.resolve(),
				sharingAvailable: () => Promise.resolve(true),
				discard: () => events.push("discarded"),
				open: () => ({
					write: () => events.push("written"),
					close: () => events.push("closed"),
				}),
			}),
		).rejects.toThrow("network lost");
		expect(events).toEqual(["written", "closed", "discarded"]);
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
