import type { ChildProcess } from "node:child_process";

import { UPLOAD_MAX_FILE_BYTES } from "@ryot-app/contract/modules/uploads/upload-policy";
import { Effect } from "effect";
import getPort from "get-port";

import { createAuthenticatedClient } from "~/fixtures/kernel";
import { assertTaggedError, requirePresent } from "~/support/assertions";
import { afterAll, beforeAll, describe, expect, it } from "~/support/effect-test";
import { getApiUrl } from "~/support/harness-target";
import {
	buildApiEnv,
	spawnApiProcess,
	startCoreTestInfrastructure,
	stopApiProcess,
	stopCoreTestInfrastructure,
	waitForHealthCheck,
} from "~/support/provisioning";

const FALLBACK_S3_BUCKET_NAME = "ryot-upload-fallback-test";

let fallbackApiPort: number;
let fallbackApiProcess: ChildProcess | undefined;
let fallbackInfrastructure: Awaited<ReturnType<typeof startCoreTestInfrastructure>> | undefined;

const getFallbackApiUrl = () => `http://127.0.0.1:${fallbackApiPort}/api`;

const expectValidExpiry = (expiresAt: string | undefined) => {
	expect(expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
	expect(Number.isNaN(Date.parse(expiresAt ?? ""))).toBe(false);
};

beforeAll(async () => {
	fallbackApiPort = await getPort();
	fallbackInfrastructure = await startCoreTestInfrastructure({
		bucketName: FALLBACK_S3_BUCKET_NAME,
	});
	const infrastructure = requirePresent(
		fallbackInfrastructure,
		"Upload fallback infrastructure is not initialised",
	);
	fallbackApiProcess = spawnApiProcess(
		buildApiEnv({
			port: fallbackApiPort,
			dbUrl: infrastructure.dbUrl,
			label: "Upload fallback api",
			redisUrl: infrastructure.redisUrl,
			s3Endpoint: infrastructure.s3Endpoint,
			s3BucketName: FALLBACK_S3_BUCKET_NAME,
			frontendUrl: `http://127.0.0.1:${fallbackApiPort}`,
			extraEnv: {
				FILE_STORAGE_S3_URL: "",
				FILE_STORAGE_S3_REGION: "",
				FILE_STORAGE_S3_ACCESS_KEY_ID: "",
				FILE_STORAGE_S3_BUCKET_NAME: "",
				FILE_STORAGE_S3_SECRET_ACCESS_KEY: "",
			},
		}),
	);
	await waitForHealthCheck(
		`http://127.0.0.1:${fallbackApiPort}/api/system/health`,
		"Upload fallback setup",
	);
});

afterAll(async () => {
	await stopApiProcess(fallbackApiProcess);
	if (fallbackInfrastructure) {
		await stopCoreTestInfrastructure(fallbackInfrastructure);
	}
});

const uploadAndComplete = (
	fileName: string,
	contentType: string,
	apiUrl = getApiUrl(),
	body = "title\nexample",
) =>
	Effect.gen(function* () {
		const { client } = yield* createAuthenticatedClient(apiUrl);
		const intent = yield* client.call((c) =>
			c.uploads.createIntent({ payload: { kind: "permanent", fileName, contentType } }),
		);
		const uploadResponse = yield* Effect.promise(() =>
			fetch(new URL(intent.uploadUrl, `${apiUrl}/`), {
				body,
				method: intent.method,
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
	it.live("selects S3 for permanent uploads when S3 is configured", () =>
		Effect.gen(function* () {
			const { asset, client, intentId } = yield* uploadAndComplete("report.csv", "text/csv");
			expect(asset).toMatchObject({ type: "s3" });
			expect(asset.key).toMatch(/^permanent\/.+\.csv$/);
			const completedAgain = yield* client.call((c) =>
				c.uploads.completeIntent({ params: { intentId } }),
			);
			const resolved = yield* client.call((c) =>
				c.uploads.resolveDownloads({ payload: { assets: [asset] } }),
			);
			expect(completedAgain).toEqual(asset);
			expect(resolved[0]?.asset).toEqual(asset);
			expect(resolved[0]?.downloadUrl).toMatch(/^https?:\/\//);
			expectValidExpiry(resolved[0]?.expiresAt);
		}),
	);

	it.live("falls back to local storage for permanent uploads when S3 is not configured", () =>
		Effect.gen(function* () {
			const apiUrl = getFallbackApiUrl();
			const { asset, client } = yield* uploadAndComplete("report.csv", "text/csv", apiUrl);
			expect(asset).toMatchObject({ type: "local" });
			expect(asset.key).toMatch(/^permanent\/.+\.csv$/);
			const resolved = yield* client.call((c) =>
				c.uploads.resolveDownloads({ payload: { assets: [asset] } }),
			);
			const downloadUrl = resolved[0]?.downloadUrl;
			expect(downloadUrl?.startsWith("uploads/local/download?")).toBe(true);
			expectValidExpiry(resolved[0]?.expiresAt);
			const downloadResponse = yield* Effect.promise(() =>
				fetch(new URL(downloadUrl ?? "", `${apiUrl}/`)),
			);
			expect(downloadResponse.status).toBe(200);
			expect(yield* Effect.promise(() => downloadResponse.text())).toBe("title\nexample");
		}),
	);

	it.live("serves local SVG artwork as a sandboxed attachment", () =>
		Effect.gen(function* () {
			const apiUrl = getFallbackApiUrl();
			const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1" />';
			const { asset, client } = yield* uploadAndComplete("cover.svg", "image/svg+xml", apiUrl, svg);
			const [resolved] = yield* client.call((c) =>
				c.uploads.resolveDownloads({ payload: { assets: [asset] } }),
			);
			const response = yield* Effect.promise(() =>
				fetch(new URL(resolved?.downloadUrl ?? "", `${apiUrl}/`)),
			);
			expect(response.status).toBe(200);
			expect(response.headers.get("content-type")).toBe("image/svg+xml");
			expect(response.headers.get("content-disposition")).toBe("attachment");
			expect(response.headers.get("content-security-policy")).toBe("sandbox");
			expect(response.headers.get("x-content-type-options")).toBe("nosniff");
			expect(yield* Effect.promise(() => response.text())).toBe(svg);
		}),
	);

	it.live("always selects local storage for temporary uploads", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const intent = yield* client.call((c) =>
				c.uploads.createIntent({
					payload: { kind: "temporary", fileName: "report.csv", contentType: "text/csv" },
				}),
			);
			expect(new URL(intent.uploadUrl, `${getApiUrl()}/`).pathname).toContain("/uploads/local/");
			const uploadResponse = yield* Effect.promise(() =>
				fetch(new URL(intent.uploadUrl, `${getApiUrl()}/`), {
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

	it.live("rejects and cleans an oversized local temporary upload", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const intent = yield* client.call((c) =>
				c.uploads.createIntent({
					payload: { kind: "temporary", contentType: "text/csv", fileName: "oversized.csv" },
				}),
			);
			const body = new Uint8Array(UPLOAD_MAX_FILE_BYTES + 1);
			body.fill(97);
			const uploadResponse = yield* Effect.promise(() =>
				fetch(new URL(intent.uploadUrl, `${getApiUrl()}/`), {
					body,
					method: intent.method,
					headers: intent.headers,
				}),
			);
			expect(uploadResponse.status).toBe(400);
			const cleaned = yield* Effect.flip(
				client.call((c) => c.uploads.completeIntent({ params: { intentId: intent.intentId } })),
			);
			assertTaggedError(cleaned, "UploadBadRequest");
			expect(cleaned.reason).toEqual({ code: "object-missing", intentId: intent.intentId });
		}),
	);

	it.live("falls back from empty and octet-stream declarations by safe extension", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			for (const contentType of ["", "application/octet-stream"]) {
				const intent = yield* client.call((c) =>
					c.uploads.createIntent({
						payload: { contentType, kind: "temporary", fileName: "fallback.csv" },
					}),
				);
				expect(intent.headers).toEqual({ "content-type": "text/csv" });
			}
			for (const fileName of ["fallback.pdf", "fallback.unknown"]) {
				const error = yield* Effect.flip(
					client.call((c) =>
						c.uploads.createIntent({
							payload: { fileName, kind: "temporary", contentType: "application/octet-stream" },
						}),
					),
				);
				assertTaggedError(error, "UploadBadRequest");
				expect(error.reason.code).toBe("unsupported-file-extension");
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
							fileName: "document.pdf",
							contentType: "application/pdf",
						},
					}),
				),
			);
			assertTaggedError(unsupported, "UploadBadRequest");
			expect(unsupported.reason).toEqual({
				code: "unsupported-file-type",
				contentType: "application/pdf",
			});

			const intent = yield* client.call((c) =>
				c.uploads.createIntent({
					payload: { kind: "permanent", fileName: "missing.csv", contentType: "text/csv" },
				}),
			);
			const missing = yield* Effect.flip(
				client.call((c) => c.uploads.completeIntent({ params: { intentId: intent.intentId } })),
			);
			assertTaggedError(missing, "UploadBadRequest");
			expect(missing.reason).toEqual({ code: "object-missing", intentId: intent.intentId });
		}),
	);

	it.live("binds local upload targets to their method, signature, and content type", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const intent = yield* client.call((c) =>
				c.uploads.createIntent({
					payload: { kind: "temporary", fileName: "signed.csv", contentType: "text/csv" },
				}),
			);
			const tamperedSignature = new URL(intent.uploadUrl, `${getApiUrl()}/`);
			tamperedSignature.searchParams.set("signature", "invalid");
			const invalidSignature = yield* Effect.promise(() =>
				fetch(tamperedSignature, {
					body: "signed",
					method: intent.method,
					headers: intent.headers,
				}),
			);
			expect(invalidSignature.status).toBe(400);

			const expired = new URL(intent.uploadUrl, `${getApiUrl()}/`);
			expired.searchParams.set("expires", "0");
			const expiredResponse = yield* Effect.promise(() =>
				fetch(expired, { body: "signed", method: intent.method, headers: intent.headers }),
			);
			expect(expiredResponse.status).toBe(400);

			const mismatchedContentType = yield* Effect.promise(() =>
				fetch(new URL(intent.uploadUrl, `${getApiUrl()}/`), {
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
					payload: { kind: "permanent", contentType: "text/csv", fileName: "other-user.csv" },
				}),
			);
			const uploadResponse = yield* Effect.promise(() =>
				fetch(new URL(intent.uploadUrl, `${getApiUrl()}/`), {
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
			assertTaggedError(error, "UploadBadRequest");
			expect(error.reason).toEqual({ code: "intent-forbidden", intentId: intent.intentId });
		}),
	);

	it.live("requires authentication for temporary intents", () =>
		Effect.gen(function* () {
			const response = yield* Effect.promise(() =>
				fetch(`${getApiUrl()}/uploads/intents`, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: '{"kind":"temporary","fileName":"report.csv","contentType":"text/csv"}',
				}),
			);
			expect(response.status).toBe(401);
		}),
	);
});

describe("GET /uploads/local/download", () => {
	it.live("serves local files with HEAD and byte range support", () =>
		Effect.gen(function* () {
			const apiUrl = getFallbackApiUrl();
			const { asset, client } = yield* uploadAndComplete("report.csv", "text/csv", apiUrl);
			const resolved = yield* client.call((c) =>
				c.uploads.resolveDownloads({ payload: { assets: [asset] } }),
			);
			expectValidExpiry(resolved[0]?.expiresAt);
			const downloadUrl = new URL(resolved[0]?.downloadUrl ?? "", `${apiUrl}/`);
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
