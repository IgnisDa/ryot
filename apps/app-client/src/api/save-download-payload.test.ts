import { describe, expect, it } from "vitest";

import { concatDownloadChunks } from "./save-download-payload";

describe("concatDownloadChunks", () => {
	it("returns an empty buffer when there are no chunks", () => {
		expect(concatDownloadChunks([])).toEqual(new Uint8Array(0));
	});

	it("joins chunks in order without padding", () => {
		const joined = concatDownloadChunks([
			new Uint8Array([1, 2]),
			new Uint8Array(0),
			new Uint8Array([3, 4, 5]),
		]);
		expect(joined).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
	});

	it("copies a single chunk instead of aliasing it", () => {
		const chunk = new Uint8Array([7, 8]);
		const joined = concatDownloadChunks([chunk]);
		chunk.set([0, 0]);
		expect(joined).toEqual(new Uint8Array([7, 8]));
	});
});
