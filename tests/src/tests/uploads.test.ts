import { describe, expect, it } from "bun:test";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { createAuthenticatedClient } from "../fixtures";
import { getBackendClient, getS3BucketName, getS3Client } from "../setup";

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
		const { data, response } = await client.POST(
			"/uploads/presigned/download",
			{ body: { keys: [key] }, headers: { Cookie: cookies } },
		);

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
