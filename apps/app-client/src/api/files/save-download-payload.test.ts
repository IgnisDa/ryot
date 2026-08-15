import { describe, expect, it } from "vitest";

import {
	collectBoundedDownloadChunks,
	DownloadTooLargeError,
	writeDownloadChunks,
} from "./save-download-payload";

const chunks = async function* (...values: number[][]) {
	await Promise.resolve();
	for (const value of values) {
		yield new Uint8Array(value);
	}
};

describe("download chunk streaming", () => {
	it("writes each chunk in order without making an archive-wide copy", async () => {
		const written: Uint8Array[] = [];
		await writeDownloadChunks(chunks([1, 2], [], [3, 4]), (chunk) => {
			written.push(chunk);
		});

		expect(written).toEqual([new Uint8Array([1, 2]), new Uint8Array([]), new Uint8Array([3, 4])]);
	});

	it("accepts fallback downloads at the byte limit", async () => {
		const values = await collectBoundedDownloadChunks({
			maxBytes: 5,
			contentLength: 5,
			chunks: chunks([1, 2], [3, 4, 5]),
		});

		expect(values).toHaveLength(2);
	});

	it("rejects an oversized Content-Length before reading the body", async () => {
		let read = false;
		const body = async function* () {
			await Promise.resolve();
			read = true;
			yield new Uint8Array([1]);
		};

		await expect(
			collectBoundedDownloadChunks({ chunks: body(), maxBytes: 5, contentLength: 6 }),
		).rejects.toBeInstanceOf(DownloadTooLargeError);
		expect(read).toBe(false);
	});

	it("stops an unknown-length body as soon as the counted limit is exceeded", async () => {
		await expect(
			collectBoundedDownloadChunks({ chunks: chunks([1, 2, 3], [4, 5, 6]), maxBytes: 5 }),
		).rejects.toBeInstanceOf(DownloadTooLargeError);
	});
});
