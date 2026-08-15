import { describe, expect, it } from "vitest";

import { MAX_BUFFERED_DOWNLOAD_BYTES } from "./save-download-payload";
import { prepareBrowserDownload, saveBrowserDownload } from "./save-download.web";

const chunks = async function* (...values: number[][]) {
	await Promise.resolve();
	for (const value of values) {
		yield new Uint8Array(value);
	}
};

describe("browser download saving", () => {
	it("streams chunks to a save picker writable and closes it", async () => {
		const events: unknown[] = [];
		const target = await prepareBrowserDownload(
			{ fileName: "backup.zip", contentType: "application/zip" },
			{
				downloadBlob: () => undefined,
				showSaveFilePicker: (options) => {
					events.push(options);
					return Promise.resolve({
						createWritable: () =>
							Promise.resolve({
								write: (chunk) => {
									events.push([...chunk]);
									return Promise.resolve();
								},
								close: () => {
									events.push("closed");
									return Promise.resolve();
								},
							}),
					});
				},
			},
		);

		await saveBrowserDownload(
			{
				target,
				fileName: "backup.zip",
				contentType: "application/zip",
				chunks: chunks([1, 2], [3]),
			},
			{ downloadBlob: () => undefined },
		);

		expect(events).toEqual([
			{
				suggestedName: "backup.zip",
				types: [{ description: "Ryot backup", accept: { "application/zip": [".zip"] } }],
			},
			[1, 2],
			[3],
			"closed",
		]);
	});

	it("creates one Blob from fallback chunks at the 50 MiB limit", async () => {
		const downloads: { readonly blob: Blob; readonly fileName: string }[] = [];
		await saveBrowserDownload(
			{
				fileName: "backup.zip",
				target: { kind: "fallback" },
				contentType: "application/zip",
				chunks: chunks([1, 2], [3]),
				contentLength: MAX_BUFFERED_DOWNLOAD_BYTES,
			},
			{ downloadBlob: (blob, fileName) => downloads.push({ blob, fileName }) },
		);

		expect(downloads).toHaveLength(1);
		expect(downloads[0]?.blob.size).toBe(3);
		expect(downloads[0]?.blob.type).toBe("application/zip");
	});

	it("rejects a fallback over 50 MiB before collecting its body", async () => {
		let bodyRead = false;
		const body = async function* () {
			await Promise.resolve();
			bodyRead = true;
			yield new Uint8Array([1]);
		};

		await expect(
			saveBrowserDownload(
				{
					chunks: body(),
					fileName: "backup.zip",
					target: { kind: "fallback" },
					contentType: "application/zip",
					contentLength: MAX_BUFFERED_DOWNLOAD_BYTES + 1,
				},
				{ downloadBlob: () => undefined },
			),
		).rejects.toThrow(/exceeds/);
		expect(bodyRead).toBe(false);
	});
});
