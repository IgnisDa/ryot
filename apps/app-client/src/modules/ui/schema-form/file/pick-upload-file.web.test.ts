import { describe, expect, it } from "vitest";

import { pickBrowserUploadFile } from "./browser-file";

describe("browser upload picker", () => {
	it("uses the DocumentPicker browser File as the upload source", async () => {
		const source = new File([new Uint8Array([1, 2, 3])], "backup.zip", {
			type: "application/x-zip-compressed",
		});
		const calls: unknown[] = [];
		const result = {
			canceled: false,
			assets: [
				{
					file: source,
					size: source.size,
					name: source.name,
					uri: "blob:backup",
					mimeType: source.type,
					lastModified: source.lastModified,
				},
			],
		} as const;

		const outcome = await pickBrowserUploadFile({ allowedFileExtensions: ["zip"] }, (options) => {
			calls.push(options);
			return Promise.resolve(result);
		});

		expect(calls).toEqual([{ base64: false, copyToCacheDirectory: false, type: ".zip" }]);
		expect(outcome.kind).toBe("picked");
		expect(outcome.kind === "picked" && outcome.file.source).toBe(source);
	});

	it("cancels when the browser picker does not provide a File", async () => {
		const outcome = await pickBrowserUploadFile({ allowedFileExtensions: ["zip"] }, () =>
			Promise.resolve({
				canceled: false,
				assets: [{ size: 1, lastModified: 0, name: "backup.zip", uri: "blob:backup" }],
			}),
		);

		expect(outcome).toEqual({ kind: "canceled" });
	});
});
