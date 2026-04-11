import { describe, expect, it } from "bun:test";

import { PutObjectCommand } from "@aws-sdk/client-s3";

import { createAuthenticatedClient } from "../fixtures";
import { getBackendClient, getBackendUrl, getS3BucketName, getS3Client } from "../setup";

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
		const { response } = await client.POST("/uploads/presigned", {
			body: { contentType: "text/csv" },
		});

		expect(response.status).toBe(401);
	});

	it("returns presigned upload URLs for csv, zip, and json", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const cases = [
			["text/csv", "csv"],
			["application/zip", "zip"],
			["application/json", "json"],
		] as const;

		await Promise.all(
			cases.map(async ([contentType, extension]) => {
				const { data, response } = await client.POST("/uploads/presigned", {
					body: { contentType },
					headers: { Cookie: cookies },
				});

				expect(response.status).toBe(200);
				const result = data?.data;
				expect(result?.key).toBeString();
				expect(result?.key.endsWith(`.${extension}`)).toBe(true);
				expect(result?.uploadUrl).toBeString();
				expect(result?.uploadUrl.length).toBeGreaterThan(0);
			}),
		);
	});
});

describe("POST /uploads/presigned/download", () => {
	it("returns 401 when not authenticated", async () => {
		const client = getBackendClient();
		const { response } = await client.POST("/uploads/presigned/download", {
			body: { keys: ["uploads/some-key.png"] },
		});

		expect(response.status).toBe(401);
	});

	it("returns 400 when keys array is empty", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { response } = await client.POST("/uploads/presigned/download", {
			body: { keys: [] },
			headers: { Cookie: cookies },
		});

		expect(response.status).toBe(400);
	});

	it("returns 400 when keys is missing", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { response } = await client.POST("/uploads/presigned/download", {
			headers: { Cookie: cookies },
			body: { keys: [] as string[] },
		});

		expect(response.status).toBe(400);
	});

	it("returns presigned download URLs for existing keys", async () => {
		const key = "uploads/test-file.txt";
		await getS3Client().send(
			new PutObjectCommand({
				Key: key,
				Body: "test content",
				Bucket: getS3BucketName(),
			}),
		);

		const { client, cookies } = await createAuthenticatedClient();
		const { data, response } = await client.POST("/uploads/presigned/download", {
			body: { keys: [key] },
			headers: { Cookie: cookies },
		});

		expect(response.status).toBe(200);
		expect(data).toBeDefined();
		const items = data?.data;
		expect(items).toHaveLength(1);
		const [item] = items ?? [];
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
		expect(response.status).toBe(200);

		const payload: Record<string, unknown> = await response.json();
		const tokens = payload.data;
		expect(isStringArray(tokens)).toBe(true);
		if (!isStringArray(tokens)) {
			throw new Error("Temporary upload response did not include tokens");
		}

		expect(tokens).toHaveLength(files.length);
		for (const token of tokens) {
			expect(token.length).toBeGreaterThan(0);
		}
	});
});
