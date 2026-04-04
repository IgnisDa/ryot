import { describe, expect, it } from "bun:test";
import { createAuthenticatedClient, createCollection } from "../fixtures";

describe("POST /collections", () => {
	it("creates a collection with valid membershipPropertiesSchema", async () => {
		const { client, cookies } = await createAuthenticatedClient();

		const membershipPropertiesSchema = {
			fields: {
				friendWhoRecommendedIt: { type: "string" as const },
				whereTheyRecommendedIt: { type: "string" as const },
			},
		};

		const collection = await createCollection(client, cookies, {
			name: "Recommended to me",
			description: "Movies and books recommended by friends",
			membershipPropertiesSchema,
		});

		expect(collection.id).toBeDefined();
		expect(collection.name).toBe("Recommended to me");
		expect(collection.properties).toMatchObject({
			description: "Movies and books recommended by friends",
			membershipPropertiesSchema,
		});
	});

	it("creates a collection without membershipPropertiesSchema", async () => {
		const { client, cookies } = await createAuthenticatedClient();

		const collection = await createCollection(client, cookies, {
			name: "Favorites",
			description: "My favorite items",
		});

		expect(collection.id).toBeDefined();
		expect(collection.name).toBe("Favorites");
		expect(collection.properties).toMatchObject({
			description: "My favorite items",
		});
	});

	it("rejects collection creation with invalid membershipPropertiesSchema", async () => {
		const { client, cookies } = await createAuthenticatedClient();

		const { response, error } = await client.POST("/collections", {
			headers: { Cookie: cookies },
			body: {
				name: "Invalid Collection",
				description: "Should fail",
				membershipPropertiesSchema: {
					fields: {
						invalidField: { type: "invalid_type" },
					},
				},
			} as unknown as { name: string; description?: string },
		});

		expect(response.status).toBe(400);
		expect(error?.error?.message).toContain("Invalid property definition");
	});

	it("rejects collection creation when membershipPropertiesSchema is not an object", async () => {
		const { client, cookies } = await createAuthenticatedClient();

		const { response, error } = await client.POST("/collections", {
			headers: { Cookie: cookies },
			body: {
				name: "Invalid Collection",
				description: "Should fail",
				membershipPropertiesSchema: "not an object",
			} as unknown as { name: string; description?: string },
		});

		expect(response.status).toBe(400);
		expect(error?.error?.message).toContain(
			"membershipPropertiesSchema must be a valid AppSchema",
		);
	});

	it("rejects collection creation when membershipPropertiesSchema lacks fields", async () => {
		const { client, cookies } = await createAuthenticatedClient();

		const { response, error } = await client.POST("/collections", {
			headers: { Cookie: cookies },
			body: {
				name: "Invalid Collection",
				description: "Should fail",
				membershipPropertiesSchema: { rules: [] },
			} as unknown as { name: string; description?: string },
		});

		expect(response.status).toBe(400);
		expect(error?.error?.message).toContain(
			"membershipPropertiesSchema must be a valid AppSchema",
		);
	});

	it("rejects unauthenticated requests", async () => {
		const { client } = await createAuthenticatedClient();

		const { response } = await client.POST("/collections", {
			body: {
				name: "Test Collection",
				description: "Should fail",
			},
		});

		expect(response.status).toBe(401);
	});

	it("rejects collection creation with empty name", async () => {
		const { client, cookies } = await createAuthenticatedClient();

		const { response, error } = await client.POST("/collections", {
			headers: { Cookie: cookies },
			body: {
				name: "",
				description: "Should fail",
			},
		});

		expect(response.status).toBe(400);
		expect(error?.error?.message).toContain("Collection name");
	});
});
