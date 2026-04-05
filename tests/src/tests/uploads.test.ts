import { describe, expect, it } from "bun:test";
import { createAuthenticatedClient } from "../fixtures";
import { getBackendClient } from "../setup";

describe("POST /uploads/presigned/download", () => {
	it("returns 401 when not authenticated", async () => {
		const client = getBackendClient();
		const { response } = await client.POST("/uploads/presigned/download", {
			body: { keys: ["uploads/some-key.png"] },
		});

		expect(response.status).toBe(401);
	});

	it("returns 422 when keys array is empty", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { response } = await client.POST("/uploads/presigned/download", {
			body: { keys: [] },
			headers: { Cookie: cookies },
		});

		expect(response.status).toBe(422);
	});

	it("returns 422 when keys is missing", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { response } = await client.POST("/uploads/presigned/download", {
			headers: { Cookie: cookies },
			body: { keys: [] as string[] },
		});

		expect(response.status).toBe(422);
	});

	it("returns 500 when S3 is not configured", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { response } = await client.POST("/uploads/presigned/download", {
			headers: { Cookie: cookies },
			body: { keys: ["uploads/some-key.png"] },
		});

		expect(response.status).toBe(500);
	});
});
