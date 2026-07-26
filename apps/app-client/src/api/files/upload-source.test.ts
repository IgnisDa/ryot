import { describe, expect, it } from "vitest";

import { temporaryUploadIntentPayload } from "./upload-intent";
import { putUploadSource } from "./upload-source";
import { putUploadSource as putBrowserUploadSource } from "./upload-source.web";

describe("file-backed upload source", () => {
	it("requests a temporary intent without choosing a storage provider", () => {
		expect(
			temporaryUploadIntentPayload({
				fileName: "backup.zip",
				contentType: "application/zip",
			}),
		).toEqual({ kind: "temporary", fileName: "backup.zip", contentType: "application/zip" });
	});

	it("uses the native File upload API with the binary source", async () => {
		const calls: unknown[] = [];
		const source = Object.assign(new Blob([new Uint8Array([1, 2, 3])]), {
			upload: (url: string, options: unknown) => {
				calls.push({ url, options });
				return Promise.resolve({ body: "", headers: {}, status: 204 });
			},
		});

		await putUploadSource({
			source,
			method: "PUT",
			fetch: globalThis.fetch,
			contentType: "application/zip",
			headers: { "x-upload": "signed" },
			url: "https://example.test/upload",
		});

		expect(calls).toEqual([
			{
				url: "https://example.test/upload",
				options: {
					httpMethod: "PUT",
					mimeType: "application/zip",
					headers: { "x-upload": "signed" },
				},
			},
		]);
	});

	it("passes the same browser File to fetch instead of reading it", async () => {
		const calls: { readonly body: BodyInit | null | undefined }[] = [];
		const receivers: unknown[] = [];
		const source = new File([new Uint8Array([1, 2, 3])], "backup.zip");
		const fetch = Object.assign(
			function (this: unknown, _url: RequestInfo | URL, options?: RequestInit) {
				receivers.push(this);
				calls.push({ body: options?.body });
				return Promise.resolve(new Response(null, { status: 204 }));
			},
			{ preconnect: () => undefined },
		);

		await putBrowserUploadSource({
			fetch,
			source,
			headers: {},
			method: "PUT",
			contentType: "application/zip",
			url: "https://example.test/upload",
		});

		expect(calls).toEqual([{ body: source }]);
		expect(receivers).toEqual([undefined]);
	});
});
