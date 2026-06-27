import { describe, expect, it } from "bun:test";

import { createAuthenticatedClient, getBackendClient, postBackendJson } from "~/fixtures";
import { getBackendUrl } from "~/setup";
import { assertCondition, assertTaggedError } from "~/support/assertions";

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

async function postTemporaryUploads(files: File[], cookies?: string) {
	const formData = new FormData();
	for (const file of files) {
		formData.append("files[]", file, file.name);
	}

	return await fetch(`${getBackendUrl()}/uploads/temporary`, {
		body: formData,
		method: "POST",
		headers: cookies ? { Cookie: cookies } : undefined,
	});
}

describe("POST /uploads/presigned", () => {
	it("returns 401 when not authenticated", async () => {
		const client = getBackendClient();
		const error = await client.runError((c) =>
			c.uploads.createPresigned({ payload: { contentType: "text/csv" } }),
		);

		assertTaggedError(error, "Unauthorized");
	});

	it("returns presigned upload URLs for csv, zip, and json", async () => {
		const { client } = await createAuthenticatedClient();
		const cases = [
			["text/csv", "csv"],
			["application/zip", "zip"],
			["application/json", "json"],
		] as const;

		await Promise.all(
			cases.map(async ([contentType, extension]) => {
				const data = await client.run((c) =>
					c.uploads.createPresigned({ payload: { contentType } }),
				);

				expect(data.key).toBeString();
				expect(data.key.endsWith(`.${extension}`)).toBe(true);
				expect(data.uploadUrl).toBeString();
				expect(data.uploadUrl.length).toBeGreaterThan(0);
			}),
		);
	});
});

describe("POST /uploads/presigned/download", () => {
	it("returns 401 when not authenticated", async () => {
		const client = getBackendClient();
		const error = await client.runError((c) =>
			c.uploads.createPresignedDownload({ payload: { keys: ["uploads/some-key.png"] } }),
		);

		assertTaggedError(error, "Unauthorized");
	});

	it("returns 400 when keys array is empty", async () => {
		const { cookies } = await createAuthenticatedClient();
		const response = await postBackendJson("/uploads/presigned/download", { keys: [] }, cookies);
		expect(response.status).toBe(400);

		const error: unknown = await response.json();
		expect(error).toMatchObject({ _tag: "BadRequest" });
	});

	it("returns 400 when keys is missing", async () => {
		const { cookies } = await createAuthenticatedClient();
		const response = await postBackendJson("/uploads/presigned/download", {}, cookies);
		expect(response.status).toBe(400);

		const error: unknown = await response.json();
		expect(error).toMatchObject({ _tag: "BadRequest" });
	});

	it("returns presigned download URLs for existing keys", async () => {
		const { client } = await createAuthenticatedClient();
		const { key, uploadUrl } = await client.run((c) =>
			c.uploads.createPresigned({ payload: { contentType: "text/csv" } }),
		);
		const uploadResponse = await fetch(uploadUrl, { method: "PUT", body: "test content" });
		expect(uploadResponse.ok).toBe(true);

		const data = await client.run((c) =>
			c.uploads.createPresignedDownload({ payload: { keys: [key] } }),
		);

		expect(data).toHaveLength(1);
		const [item] = data;
		expect(item?.key).toBe(key);
		expect(item?.downloadUrl).toBeString();
		expect(item?.downloadUrl.length).toBeGreaterThan(0);
	});
});

describe("POST /uploads/temporary", () => {
	it("returns 401 when not authenticated", async () => {
		const response = await postTemporaryUploads([
			new File(["csv data"], "report.csv", { type: "text/csv" }),
		]);

		expect(response.status).toBe(401);
	});

	it("returns 400 when body is not multipart form data", async () => {
		const { cookies } = await createAuthenticatedClient();
		const response = await fetch(`${getBackendUrl()}/uploads/temporary`, {
			method: "POST",
			body: JSON.stringify({ files: [] }),
			headers: { Cookie: cookies, "Content-Type": "application/json" },
		});

		expect(response.status).toBe(400);
	});

	it("writes csv, zip, and json files to disk and returns tokens", async () => {
		const { cookies } = await createAuthenticatedClient();
		const files = [
			new File(["csv data"], "report.csv", { type: "text/csv" }),
			new File(["zip data"], "archive.zip", { type: "application/zip" }),
			new File(["json data"], "payload.json", { type: "application/json" }),
		];

		const response = await postTemporaryUploads(files, cookies);
		expect(response.status).toBe(201);

		const tokens: unknown = await response.json();
		expect(isStringArray(tokens)).toBe(true);
		assertCondition(isStringArray(tokens), "Temporary upload response did not include tokens");

		expect(tokens).toHaveLength(files.length);
		for (const token of tokens) {
			expect(token.length).toBeGreaterThan(0);
		}
	});

	it("accepts MyAnimeList xml and gzip uploads", async () => {
		const { cookies } = await createAuthenticatedClient();
		const files = [
			new File(["<anime></anime>"], "anime.xml"),
			new File(["gzip payload"], "manga.xml.gz", { type: "application/octet-stream" }),
		];

		const response = await postTemporaryUploads(files, cookies);
		expect(response.status).toBe(201);

		const tokens: unknown = await response.json();
		expect(isStringArray(tokens)).toBe(true);
	});

	it("returns 413 when the multipart body exceeds the maximum allowed size", async () => {
		const { cookies } = await createAuthenticatedClient();
		const oversizedFile = new File([new Uint8Array(55 * 1024 * 1024)], "oversized.csv", {
			type: "text/csv",
		});

		const response = await postTemporaryUploads([oversizedFile], cookies);
		expect(response.status).toBe(413);
	});
});
