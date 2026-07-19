import { UPLOAD_MAX_FILE_BYTES } from "@ryot/contract/modules/uploads/upload-policy";
import { Effect } from "effect";

import { createAuthenticatedClient } from "~/fixtures";
import { assertTaggedError } from "~/support/assertions";
import { getBackendUrl } from "~/support/backend";
import { describe, expect, it } from "~/support/effect-test";

const uploadAndComplete = (provider: "local" | "s3", fileName: string, contentType: string) =>
	Effect.gen(function* () {
		const { client } = yield* createAuthenticatedClient();
		const intent = yield* client.call((c) =>
			c.uploads.createIntent({ payload: { kind: "permanent", provider, fileName, contentType } }),
		);
		const uploadResponse = yield* Effect.promise(() =>
			fetch(new URL(intent.uploadUrl, `${getBackendUrl()}/`), {
				method: intent.method,
				body: "title\nexample",
				headers: intent.headers,
			}),
		);
		expect([200, 204]).toContain(uploadResponse.status);
		const asset = yield* client.call((c) =>
			c.uploads.completeIntent({ params: { intentId: intent.intentId } }),
		);
		if (!("key" in asset)) {
			throw new Error("Expected a permanent asset locator");
		}
		return { asset, client, intentId: intent.intentId };
	});

describe("POST /uploads/intents", () => {
	it.live("creates, uploads, and completes a local permanent intent", () =>
		Effect.gen(function* () {
			const { asset, client, intentId } = yield* uploadAndComplete(
				"local",
				"report.csv",
				"text/csv",
			);
			expect(asset).toMatchObject({ type: "local" });
			expect(asset.key).toMatch(/^permanent\/.+\.csv$/);
			const completedAgain = yield* client.call((c) =>
				c.uploads.completeIntent({ params: { intentId } }),
			);
			const resolved = yield* client.call((c) =>
				c.uploads.resolveDownloads({ payload: { assets: [asset] } }),
			);
			expect(completedAgain).toEqual(asset);
			expect(resolved[0]?.asset).toEqual(asset);
			expect(resolved[0]?.downloadUrl.startsWith("uploads/local/download?")).toBe(true);
		}),
	);

	it.live("creates, uploads directly to, and completes an S3 permanent intent", () =>
		Effect.gen(function* () {
			const { asset, client } = yield* uploadAndComplete("s3", "report.csv", "text/csv");
			expect(asset).toMatchObject({ type: "s3" });
			expect(asset.key).toMatch(/^permanent\/.+\.csv$/);
			const resolved = yield* client.call((c) =>
				c.uploads.resolveDownloads({ payload: { assets: [asset] } }),
			);
			const downloadUrl = resolved[0]?.downloadUrl;
			expect(downloadUrl).toMatch(/^https?:\/\//);
			const downloadResponse = yield* Effect.promise(() => fetch(downloadUrl ?? ""));
			expect(downloadResponse.status).toBe(200);
			expect(yield* Effect.promise(() => downloadResponse.text())).toBe("title\nexample");
		}),
	);

	it.live("creates, uploads, and completes a local temporary intent", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const intent = yield* client.call((c) =>
				c.uploads.createIntent({
					payload: {
						kind: "temporary",
						provider: "local",
						fileName: "report.csv",
						contentType: "text/csv",
					},
				}),
			);
			const uploadResponse = yield* Effect.promise(() =>
				fetch(new URL(intent.uploadUrl, `${getBackendUrl()}/`), {
					method: intent.method,
					body: "temporary data",
					headers: intent.headers,
				}),
			);
			expect([200, 204]).toContain(uploadResponse.status);
			const token = yield* client.call((c) =>
				c.uploads.completeIntent({ params: { intentId: intent.intentId } }),
			);
			if (!("token" in token)) {
				throw new Error("Expected a temporary upload token");
			}
			expect(token.token).toMatch(/^[A-Za-z0-9_-]+$/);
			expect(token.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
		}),
	);

	it.live("creates, uploads directly to, and completes an S3 temporary intent", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const intent = yield* client.call((c) =>
				c.uploads.createIntent({
					payload: {
						provider: "s3",
						kind: "temporary",
						fileName: "report.csv",
						contentType: "text/csv",
					},
				}),
			);
			expect(intent.uploadUrl).toMatch(/^https?:\/\//);
			const uploadResponse = yield* Effect.promise(() =>
				fetch(intent.uploadUrl, {
					method: intent.method,
					headers: intent.headers,
					body: "temporary S3 data",
				}),
			);
			expect([200, 204]).toContain(uploadResponse.status);
			const token = yield* client.call((c) =>
				c.uploads.completeIntent({ params: { intentId: intent.intentId } }),
			);
			if (!("token" in token)) {
				throw new Error("Expected a temporary upload token");
			}
			expect(token.token).toMatch(/^[A-Za-z0-9_-]+$/);
			expect(token.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
		}),
	);

	it.live("rejects and cleans an oversized S3 temporary completion", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const intent = yield* client.call((c) =>
				c.uploads.createIntent({
					payload: {
						provider: "s3",
						kind: "temporary",
						contentType: "text/csv",
						fileName: "oversized.csv",
					},
				}),
			);
			const body = new Uint8Array(UPLOAD_MAX_FILE_BYTES + 1);
			body.fill(97);
			const uploadResponse = yield* Effect.promise(() =>
				fetch(intent.uploadUrl, { body, method: intent.method, headers: intent.headers }),
			);
			expect([200, 204]).toContain(uploadResponse.status);
			const error = yield* Effect.flip(
				client.call((c) => c.uploads.completeIntent({ params: { intentId: intent.intentId } })),
			);
			assertTaggedError(error, "BadRequest");
			const cleaned = yield* Effect.flip(
				client.call((c) => c.uploads.completeIntent({ params: { intentId: intent.intentId } })),
			);
			expect(cleaned.message).toContain("missing");
		}),
	);

	it.live("falls back from empty and octet-stream declarations by safe extension", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			for (const contentType of ["", "application/octet-stream"]) {
				const intent = yield* client.call((c) =>
					c.uploads.createIntent({
						payload: {
							contentType,
							kind: "temporary",
							provider: "local",
							fileName: "fallback.csv",
						},
					}),
				);
				expect(intent.headers).toEqual({ "content-type": "text/csv" });
			}
			for (const fileName of ["fallback.pdf", "fallback.unknown"]) {
				const error = yield* Effect.flip(
					client.call((c) =>
						c.uploads.createIntent({
							payload: {
								fileName,
								kind: "temporary",
								provider: "local",
								contentType: "application/octet-stream",
							},
						}),
					),
				);
				assertTaggedError(error, "BadRequest");
			}
		}),
	);

	it.live("rejects unsupported content types and missing upload objects", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const unsupported = yield* Effect.flip(
				client.call((c) =>
					c.uploads.createIntent({
						payload: {
							kind: "permanent",
							provider: "local",
							fileName: "document.pdf",
							contentType: "application/pdf",
						},
					}),
				),
			);
			assertTaggedError(unsupported, "BadRequest");

			const intent = yield* client.call((c) =>
				c.uploads.createIntent({
					payload: {
						kind: "permanent",
						provider: "local",
						fileName: "missing.csv",
						contentType: "text/csv",
					},
				}),
			);
			const missing = yield* Effect.flip(
				client.call((c) => c.uploads.completeIntent({ params: { intentId: intent.intentId } })),
			);
			assertTaggedError(missing, "BadRequest");
		}),
	);

	it.live("binds local upload targets to their method, signature, and content type", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const intent = yield* client.call((c) =>
				c.uploads.createIntent({
					payload: {
						kind: "temporary",
						provider: "local",
						fileName: "signed.csv",
						contentType: "text/csv",
					},
				}),
			);
			const tamperedSignature = new URL(intent.uploadUrl, `${getBackendUrl()}/`);
			tamperedSignature.searchParams.set("signature", "invalid");
			const invalidSignature = yield* Effect.promise(() =>
				fetch(tamperedSignature, {
					body: "signed",
					method: intent.method,
					headers: intent.headers,
				}),
			);
			expect(invalidSignature.status).toBe(400);

			const expired = new URL(intent.uploadUrl, `${getBackendUrl()}/`);
			expired.searchParams.set("expires", "0");
			const expiredResponse = yield* Effect.promise(() =>
				fetch(expired, {
					body: "signed",
					method: intent.method,
					headers: intent.headers,
				}),
			);
			expect(expiredResponse.status).toBe(400);

			const mismatchedContentType = yield* Effect.promise(() =>
				fetch(new URL(intent.uploadUrl, `${getBackendUrl()}/`), {
					body: "signed",
					method: intent.method,
					headers: { ...intent.headers, "content-type": "application/json" },
				}),
			);
			expect(mismatchedContentType.status).toBe(400);
		}),
	);

	it.live("rejects completion by another user", () =>
		Effect.gen(function* () {
			const first = yield* createAuthenticatedClient();
			const second = yield* createAuthenticatedClient();
			const intent = yield* first.client.call((c) =>
				c.uploads.createIntent({
					payload: {
						kind: "permanent",
						provider: "local",
						contentType: "text/csv",
						fileName: "other-user.csv",
					},
				}),
			);
			const uploadResponse = yield* Effect.promise(() =>
				fetch(new URL(intent.uploadUrl, `${getBackendUrl()}/`), {
					method: intent.method,
					body: "title\nexample",
					headers: intent.headers,
				}),
			);
			expect([200, 204]).toContain(uploadResponse.status);
			const error = yield* Effect.flip(
				second.client.call((c) =>
					c.uploads.completeIntent({ params: { intentId: intent.intentId } }),
				),
			);
			assertTaggedError(error, "BadRequest");
		}),
	);

	it.live("requires authentication for temporary intents", () =>
		Effect.gen(function* () {
			const response = yield* Effect.promise(() =>
				fetch(`${getBackendUrl()}/uploads/intents`, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: '{"kind":"temporary","provider":"local","fileName":"report.csv","contentType":"text/csv"}',
				}),
			);
			expect(response.status).toBe(401);
		}),
	);
});

describe("GET /uploads/local/download", () => {
	it.live("serves local files with HEAD and byte range support", () =>
		Effect.gen(function* () {
			const { asset, client } = yield* uploadAndComplete("local", "report.csv", "text/csv");
			const resolved = yield* client.call((c) =>
				c.uploads.resolveDownloads({ payload: { assets: [asset] } }),
			);
			const downloadUrl = new URL(resolved[0]?.downloadUrl ?? "", `${getBackendUrl()}/`);
			const head = yield* Effect.promise(() => fetch(downloadUrl, { method: "HEAD" }));
			expect(head.status).toBe(200);
			expect(head.headers.get("content-type")).toContain("text/csv");
			expect(head.headers.get("content-length")).toBe("13");
			expect(head.headers.get("content-disposition")).toBe("inline");
			const range = yield* Effect.promise(() =>
				fetch(downloadUrl, { headers: { Range: "bytes=0-4" } }),
			);
			expect(range.status).toBe(206);
			expect(range.headers.get("content-range")).toBe("bytes 0-4/13");
			expect(yield* Effect.promise(() => range.text())).toBe("title");
			const invalidRange = yield* Effect.promise(() =>
				fetch(downloadUrl, { headers: { Range: "bytes=99-100" } }),
			);
			expect(invalidRange.status).toBe(416);
			expect(invalidRange.headers.get("content-range")).toBe("bytes */13");

			const invalidSignature = new URL(downloadUrl);
			invalidSignature.searchParams.set("signature", "invalid");
			const invalidSignatureResponse = yield* Effect.promise(() => fetch(invalidSignature));
			expect(invalidSignatureResponse.status).toBe(400);
		}),
	);
});

describe("legacy upload routes", () => {
	it.live("does not retain the S3-specific presign routes", () =>
		Effect.gen(function* () {
			const response = yield* Effect.promise(() =>
				fetch(`${getBackendUrl()}/uploads/presigned`, { method: "POST" }),
			);
			expect(response.status).toBe(404);
			const downloadResponse = yield* Effect.promise(() =>
				fetch(`${getBackendUrl()}/uploads/presigned/download`, { method: "POST" }),
			);
			expect(downloadResponse.status).toBe(404);
			const temporaryResponse = yield* Effect.promise(() =>
				fetch(`${getBackendUrl()}/uploads/temporary`, { method: "POST" }),
			);
			expect(temporaryResponse.status).toBe(404);
		}),
	);
});
