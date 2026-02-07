import { Effect } from "effect";

import { createAuthenticatedClient, getBackendClient, postBackendJson } from "~/fixtures";
import { assertCondition, assertTaggedError } from "~/support/assertions";
import { getBackendUrl } from "~/support/backend";
import { describe, expect, it } from "~/support/effect-test";

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

const postTemporaryUploads = (files: File[], cookies?: string) =>
	Effect.promise(() => {
		const formData = new FormData();
		for (const file of files) {
			formData.append("files[]", file, file.name);
		}

		return fetch(`${getBackendUrl()}/uploads/temporary`, {
			body: formData,
			method: "POST",
			headers: cookies ? { Cookie: cookies } : undefined,
		});
	});

describe("POST /uploads/presigned", () => {
	it.live("returns 401 when not authenticated", () =>
		Effect.gen(function* () {
			const client = getBackendClient();
			const error = yield* Effect.flip(
				client.call((c) => c.uploads.createPresigned({ payload: { contentType: "text/csv" } })),
			);

			assertTaggedError(error, "Unauthorized");
		}),
	);

	it.live("returns presigned upload URLs for csv, zip, and json", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const cases = [
				["text/csv", "csv"],
				["application/zip", "zip"],
				["application/json", "json"],
			] as const;

			yield* Effect.all(
				cases.map(([contentType, extension]) =>
					Effect.gen(function* () {
						const data = yield* client.call((c) =>
							c.uploads.createPresigned({ payload: { contentType } }),
						);

						expect(data.key).toBeTypeOf("string");
						expect(data.key.endsWith(`.${extension}`)).toBe(true);
						expect(data.uploadUrl).toBeTypeOf("string");
						expect(data.uploadUrl.length).toBeGreaterThan(0);
					}),
				),
			);
		}),
	);
});

describe("POST /uploads/presigned/download", () => {
	it.live("returns 401 when not authenticated", () =>
		Effect.gen(function* () {
			const client = getBackendClient();
			const error = yield* Effect.flip(
				client.call((c) =>
					c.uploads.createPresignedDownload({ payload: { keys: ["uploads/some-key.png"] } }),
				),
			);

			assertTaggedError(error, "Unauthorized");
		}),
	);

	it.live("returns 400 when keys array is empty", () =>
		Effect.gen(function* () {
			const { cookies } = yield* createAuthenticatedClient();
			const response = yield* Effect.promise(() =>
				postBackendJson("/uploads/presigned/download", { keys: [] }, cookies),
			);
			expect(response.status).toBe(400);

			const error: unknown = yield* Effect.promise(() => response.json());
			expect(error).toMatchObject({ _tag: "BadRequest" });
		}),
	);

	it.live("returns 400 when keys is missing", () =>
		Effect.gen(function* () {
			const { cookies } = yield* createAuthenticatedClient();
			const response = yield* Effect.promise(() =>
				postBackendJson("/uploads/presigned/download", {}, cookies),
			);
			expect(response.status).toBe(400);

			const error: unknown = yield* Effect.promise(() => response.json());
			expect(error).toMatchObject({ _tag: "BadRequest" });
		}),
	);

	it.live("returns presigned download URLs for existing keys", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { key, uploadUrl } = yield* client.call((c) =>
				c.uploads.createPresigned({ payload: { contentType: "text/csv" } }),
			);
			const uploadResponse = yield* Effect.promise(() =>
				fetch(uploadUrl, { method: "PUT", body: "test content" }),
			);
			expect(uploadResponse.ok).toBe(true);

			const data = yield* client.call((c) =>
				c.uploads.createPresignedDownload({ payload: { keys: [key] } }),
			);

			expect(data).toHaveLength(1);
			const [item] = data;
			expect(item?.key).toBe(key);
			expect(item?.downloadUrl).toBeTypeOf("string");
			expect(item?.downloadUrl.length).toBeGreaterThan(0);
		}),
	);
});

describe("POST /uploads/temporary", () => {
	it.live("returns 401 when not authenticated", () =>
		Effect.gen(function* () {
			const response = yield* postTemporaryUploads([
				new File(["csv data"], "report.csv", { type: "text/csv" }),
			]);

			expect(response.status).toBe(401);
		}),
	);

	it.live("returns 415 when body is not multipart form data", () =>
		Effect.gen(function* () {
			const { cookies } = yield* createAuthenticatedClient();
			const response = yield* Effect.promise(() =>
				fetch(`${getBackendUrl()}/uploads/temporary`, {
					method: "POST",
					body: JSON.stringify({ files: [] }),
					headers: { Cookie: cookies, "Content-Type": "application/json" },
				}),
			);

			expect(response.status).toBe(415);
		}),
	);

	it.live("writes csv, zip, and json files to disk and returns tokens", () =>
		Effect.gen(function* () {
			const { cookies } = yield* createAuthenticatedClient();
			const files = [
				new File(["csv data"], "report.csv", { type: "text/csv" }),
				new File(["zip data"], "archive.zip", { type: "application/zip" }),
				new File(["json data"], "payload.json", { type: "application/json" }),
			];

			const response = yield* postTemporaryUploads(files, cookies);
			expect(response.status).toBe(201);

			const tokens: unknown = yield* Effect.promise(() => response.json());
			expect(isStringArray(tokens)).toBe(true);
			assertCondition(isStringArray(tokens), "Temporary upload response did not include tokens");

			expect(tokens).toHaveLength(files.length);
			for (const token of tokens) {
				expect(token.length).toBeGreaterThan(0);
			}
		}),
	);

	it.live("accepts MyAnimeList xml and gzip uploads", () =>
		Effect.gen(function* () {
			const { cookies } = yield* createAuthenticatedClient();
			const files = [
				new File(["<anime></anime>"], "anime.xml"),
				new File(["gzip payload"], "manga.xml.gz", { type: "application/octet-stream" }),
			];

			const response = yield* postTemporaryUploads(files, cookies);
			expect(response.status).toBe(201);

			const tokens: unknown = yield* Effect.promise(() => response.json());
			expect(isStringArray(tokens)).toBe(true);
		}),
	);

	it.live("returns 413 when the multipart body exceeds the maximum allowed size", () =>
		Effect.gen(function* () {
			const { cookies } = yield* createAuthenticatedClient();
			const oversizedFile = new File([new Uint8Array(55 * 1024 * 1024)], "oversized.csv", {
				type: "text/csv",
			});

			const response = yield* postTemporaryUploads([oversizedFile], cookies);
			expect(response.status).toBe(413);
		}),
	);
});
