import { describe, expect, it } from "bun:test";
import {
	createAuthenticatedClient,
	createCollection,
	createEntity,
	createEntitySchema,
	createTracker,
} from "../fixtures";

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
		expect(error?.error?.message).toContain("Invalid input");
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
		expect(error?.error?.message).toContain("expected object, received string");
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
			"expected record, received undefined",
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
		expect(error?.error?.message).toContain(
			"Too small: expected string to have >=1 characters",
		);
	});

	describe("nested membershipPropertiesSchema validation", () => {
		it("creates a collection with deeply nested object properties", async () => {
			const { client, cookies } = await createAuthenticatedClient();

			const membershipPropertiesSchema = {
				fields: {
					friendWhoRecommendedIt: { type: "string" as const },
					recommendationDetails: {
						type: "object" as const,
						properties: {
							where: { type: "string" as const },
							when: { type: "date" as const },
							rating: { type: "integer" as const },
						},
					},
				},
			};

			const collection = await createCollection(client, cookies, {
				name: "Nested Schema Collection",
				description: "Testing nested properties",
				membershipPropertiesSchema,
			});

			expect(collection.id).toBeDefined();
			expect(collection.properties.membershipPropertiesSchema).toEqual(
				membershipPropertiesSchema,
			);
		});

		it("creates a collection with array item schemas", async () => {
			const { client, cookies } = await createAuthenticatedClient();

			const membershipPropertiesSchema = {
				fields: {
					tags: {
						type: "array" as const,
						items: { type: "string" as const },
					},
					recommendations: {
						type: "array" as const,
						items: {
							type: "object" as const,
							properties: {
								friend: { type: "string" as const },
								context: { type: "string" as const },
							},
						},
					},
				},
			};

			const collection = await createCollection(client, cookies, {
				name: "Array Schema Collection",
				description: "Testing array item schemas",
				membershipPropertiesSchema,
			});

			expect(collection.id).toBeDefined();
			expect(collection.properties.membershipPropertiesSchema).toEqual(
				membershipPropertiesSchema,
			);
		});

		it("rejects collection creation with invalid nested property type", async () => {
			const { client, cookies } = await createAuthenticatedClient();

			const { response, error } = await client.POST("/collections", {
				headers: { Cookie: cookies },
				body: {
					name: "Invalid Nested Collection",
					description: "Should fail",
					membershipPropertiesSchema: {
						fields: {
							nested: {
								type: "object" as const,
								properties: {
									invalidField: { type: "unknown_type" },
								},
							},
						},
					},
				} as unknown as { name: string; description?: string },
			});

			expect(response.status).toBe(400);
			expect(error?.error?.message).toContain("Invalid property definition");
		});

		it("rejects collection creation with invalid nested array item type", async () => {
			const { client, cookies } = await createAuthenticatedClient();

			const { response, error } = await client.POST("/collections", {
				headers: { Cookie: cookies },
				body: {
					name: "Invalid Array Collection",
					description: "Should fail",
					membershipPropertiesSchema: {
						fields: {
							tags: {
								type: "array" as const,
								items: { type: "unknown_type" },
							},
						},
					},
				} as unknown as { name: string; description?: string },
			});

			expect(response.status).toBe(400);
			expect(error?.error?.message).toContain("Invalid property definition");
		});

		it("creates a collection with multi-level nested schema", async () => {
			const { client, cookies } = await createAuthenticatedClient();

			const membershipPropertiesSchema = {
				fields: {
					metadata: {
						type: "object" as const,
						properties: {
							source: {
								type: "object" as const,
								properties: {
									name: { type: "string" as const },
									url: { type: "string" as const },
								},
							},
							tags: {
								type: "array" as const,
								items: {
									type: "object" as const,
									properties: {
										label: { type: "string" as const },
										color: { type: "string" as const },
									},
								},
							},
						},
					},
					priority: { type: "integer" as const },
				},
			};

			const collection = await createCollection(client, cookies, {
				name: "Complex Nested Collection",
				description: "Testing multi-level nesting",
				membershipPropertiesSchema,
			});

			expect(collection.id).toBeDefined();
			expect(collection.properties.membershipPropertiesSchema).toEqual(
				membershipPropertiesSchema,
			);
		});
	});

	describe("POST /collections/memberships", () => {
		it("adds an entity to a collection", async () => {
			const { client, cookies } = await createAuthenticatedClient();

			// Create a collection
			const collection = await createCollection(client, cookies, {
				name: "Test Collection",
				description: "For testing add to collection",
			});

			// Create a tracker and entity schema
			const tracker = await createTracker(client, cookies, {
				name: `Test Tracker ${crypto.randomUUID()}`,
			});

			const { schemaId: entitySchemaId } = await createEntitySchema(
				client,
				cookies,
				{
					trackerId: tracker.trackerId,
					propertiesSchema: { fields: { title: { type: "string" as const } } },
				},
			);

			// Create an entity
			const entity = await createEntity(client, cookies, {
				entitySchemaId,
				name: "Test Entity",
				image: null,
				properties: { title: "Test Title" },
			});

			// Add entity to collection
			const { data, response } = await client.POST("/collections/memberships", {
				headers: { Cookie: cookies },
				body: {
					collectionId: collection.id,
					entityId: entity.id,
				},
			});

			expect(response.status).toBe(200);
			expect(data?.data?.collection?.id).toBeDefined();
			expect(data?.data?.collection?.relType).toBe("collection");
			expect(data?.data?.collection?.sourceEntityId).toBe(collection.id);
			expect(data?.data?.collection?.targetEntityId).toBe(entity.id);
		});

		it("adds an entity with custom properties", async () => {
			const { client, cookies } = await createAuthenticatedClient();

			// Create a collection with membershipPropertiesSchema
			const collection = await createCollection(client, cookies, {
				name: "Movies with metadata",
				description: "Movies with recommendation info",
				membershipPropertiesSchema: {
					fields: {
						recommendedBy: { type: "string" },
						rating: { type: "integer" },
					},
				},
			});

			// Create an entity
			const tracker = await createTracker(client, cookies, {
				name: `Test Tracker ${crypto.randomUUID()}`,
			});

			const { schemaId: entitySchemaId } = await createEntitySchema(
				client,
				cookies,
				{
					trackerId: tracker.trackerId,
					propertiesSchema: { fields: { title: { type: "string" as const } } },
				},
			);

			const entity = await createEntity(client, cookies, {
				entitySchemaId,
				name: "Inception",
				image: null,
				properties: { title: "Inception" },
			});

			// Add entity to collection with custom properties
			const { data, response } = await client.POST("/collections/memberships", {
				headers: { Cookie: cookies },
				body: {
					collectionId: collection.id,
					entityId: entity.id,
					properties: {
						recommendedBy: "John",
						rating: 5,
					},
				},
			});

			expect(response.status).toBe(200);
			expect(data?.data?.collection?.properties).toMatchObject({
				recommendedBy: "John",
				rating: 5,
			});
		});

		it("returns 404 when collection does not exist", async () => {
			const { client, cookies } = await createAuthenticatedClient();

			// Create a tracker and entity
			const tracker = await createTracker(client, cookies, {
				name: `Test Tracker ${crypto.randomUUID()}`,
			});

			const { schemaId: entitySchemaId } = await createEntitySchema(
				client,
				cookies,
				{
					trackerId: tracker.trackerId,
					propertiesSchema: { fields: { title: { type: "string" as const } } },
				},
			);

			const entity = await createEntity(client, cookies, {
				entitySchemaId,
				name: "Test Entity",
				image: null,
				properties: { title: "Test Title" },
			});

			// Try to add to non-existent collection
			const { response, error } = await client.POST(
				"/collections/memberships",
				{
					headers: { Cookie: cookies },
					body: {
						collectionId: "nonexistent-collection-id",
						entityId: entity.id,
					},
				},
			);

			expect(response.status).toBe(404);
			expect(error?.error?.message).toContain("Collection not found");
		});

		it("returns 404 when entity does not exist", async () => {
			const { client, cookies } = await createAuthenticatedClient();

			// Create a collection
			const collection = await createCollection(client, cookies, {
				name: "Test Collection",
				description: "For testing add to collection",
			});

			// Try to add non-existent entity
			const { response, error } = await client.POST(
				"/collections/memberships",
				{
					headers: { Cookie: cookies },
					body: {
						collectionId: collection.id,
						entityId: "nonexistent-entity-id",
					},
				},
			);

			expect(response.status).toBe(404);
			expect(error?.error?.message).toContain("Entity not found");
		});

		it("returns 404 when trying to add to another user's collection", async () => {
			// Create two different users
			const { client: clientA, cookies: cookiesA } =
				await createAuthenticatedClient();
			const { client: clientB, cookies: cookiesB } =
				await createAuthenticatedClient();

			// User A creates a collection
			const collection = await createCollection(clientA, cookiesA, {
				name: "User A's Private Collection",
				description: "Should not be accessible by User B",
			});

			// User B creates an entity
			const tracker = await createTracker(clientB, cookiesB, {
				name: `Test Tracker ${crypto.randomUUID()}`,
			});

			const { schemaId: entitySchemaId } = await createEntitySchema(
				clientB,
				cookiesB,
				{
					trackerId: tracker.trackerId,
					propertiesSchema: { fields: { title: { type: "string" as const } } },
				},
			);

			const entity = await createEntity(clientB, cookiesB, {
				entitySchemaId,
				name: "User B's Entity",
				image: null,
				properties: { title: "Test Title" },
			});

			// User B tries to add their entity to User A's collection
			const { response, error } = await clientB.POST(
				"/collections/memberships",
				{
					headers: { Cookie: cookiesB },
					body: {
						collectionId: collection.id,
						entityId: entity.id,
					},
				},
			);

			expect(response.status).toBe(404);
			expect(error?.error?.message).toContain("Collection not found");
		});

		it("rejects unauthenticated requests", async () => {
			const { client } = await createAuthenticatedClient();

			const { response } = await client.POST("/collections/memberships", {
				body: {
					collectionId: "some-collection-id",
					entityId: "some-entity-id",
				},
			});

			expect(response.status).toBe(401);
		});
	});
	it("removes an entity from a collection and deletes both relationships", async () => {
		const { client, cookies } = await createAuthenticatedClient();

		// Create a collection
		const collection = await createCollection(client, cookies, {
			name: "Test Collection for Removal",
			description: "For testing remove from collection",
		});

		// Create a tracker and entity schema
		const tracker = await createTracker(client, cookies, {
			name: `Test Tracker ${crypto.randomUUID()}`,
		});

		const { schemaId: entitySchemaId } = await createEntitySchema(
			client,
			cookies,
			{
				trackerId: tracker.trackerId,
				propertiesSchema: { fields: { title: { type: "string" as const } } },
			},
		);

		// Create an entity
		const entity = await createEntity(client, cookies, {
			entitySchemaId,
			name: "Test Entity",
			image: null,
			properties: { title: "Test Title" },
		});

		// Add entity to collection first
		const { data: addData, response: addResponse } = await client.POST(
			"/collections/memberships",
			{
				headers: { Cookie: cookies },
				body: {
					collectionId: collection.id,
					entityId: entity.id,
				},
			},
		);

		expect(addResponse.status).toBe(200);
		expect(addData?.data?.collection?.relType).toBe("collection");

		// Now remove the entity from the collection
		const { data: removeData, response: removeResponse } = await client.DELETE(
			"/collections/memberships",
			{
				headers: { Cookie: cookies },
				body: {
					collectionId: collection.id,
					entityId: entity.id,
				},
			},
		);

		expect(removeResponse.status).toBe(200);
		expect(removeData?.data?.collection?.relType).toBe("collection");
		expect(removeData?.data?.memberOf?.relType).toBe("member_of");
		expect(removeData?.data?.collection?.sourceEntityId).toBe(collection.id);
		expect(removeData?.data?.collection?.targetEntityId).toBe(entity.id);
		expect(removeData?.data?.memberOf?.sourceEntityId).toBe(entity.id);
		expect(removeData?.data?.memberOf?.targetEntityId).toBe(collection.id);
	});

	it("returns 404 when removing entity not in collection", async () => {
		const { client, cookies } = await createAuthenticatedClient();

		// Create a collection
		const collection = await createCollection(client, cookies, {
			name: "Test Collection",
			description: "For testing remove from collection",
		});

		// Create a tracker and entity
		const tracker = await createTracker(client, cookies, {
			name: `Test Tracker ${crypto.randomUUID()}`,
		});

		const { schemaId: entitySchemaId } = await createEntitySchema(
			client,
			cookies,
			{
				trackerId: tracker.trackerId,
				propertiesSchema: { fields: { title: { type: "string" as const } } },
			},
		);

		const entity = await createEntity(client, cookies, {
			entitySchemaId,
			name: "Test Entity",
			image: null,
			properties: { title: "Test Title" },
		});

		// Try to remove entity that was never added to collection
		const { response, error } = await client.DELETE(
			"/collections/memberships",
			{
				headers: { Cookie: cookies },
				body: {
					collectionId: collection.id,
					entityId: entity.id,
				},
			},
		);

		expect(response.status).toBe(404);
		expect(error?.error?.message).toContain("Entity is not in collection");
	});

	it("returns 404 when collection does not exist", async () => {
		const { client, cookies } = await createAuthenticatedClient();

		// Create an entity
		const tracker = await createTracker(client, cookies, {
			name: `Test Tracker ${crypto.randomUUID()}`,
		});

		const { schemaId: entitySchemaId } = await createEntitySchema(
			client,
			cookies,
			{
				trackerId: tracker.trackerId,
				propertiesSchema: { fields: { title: { type: "string" as const } } },
			},
		);

		const entity = await createEntity(client, cookies, {
			entitySchemaId,
			name: "Test Entity",
			image: null,
			properties: { title: "Test Title" },
		});

		// Try to remove from non-existent collection
		const { response, error } = await client.DELETE(
			"/collections/memberships",
			{
				headers: { Cookie: cookies },
				body: {
					collectionId: "nonexistent-collection-id",
					entityId: entity.id,
				},
			},
		);

		expect(response.status).toBe(404);
		expect(error?.error?.message).toContain("Collection not found");
	});

	it("returns 404 when trying to remove from another user's collection", async () => {
		// Create two different users
		const { client: clientA, cookies: cookiesA } =
			await createAuthenticatedClient();
		const { client: clientB, cookies: cookiesB } =
			await createAuthenticatedClient();

		// User A creates a collection
		const collection = await createCollection(clientA, cookiesA, {
			name: "User A's Private Collection",
			description: "Should not be accessible by User B",
		});

		// User B creates an entity
		const tracker = await createTracker(clientB, cookiesB, {
			name: `Test Tracker ${crypto.randomUUID()}`,
		});

		const { schemaId: entitySchemaId } = await createEntitySchema(
			clientB,
			cookiesB,
			{
				trackerId: tracker.trackerId,
				propertiesSchema: { fields: { title: { type: "string" as const } } },
			},
		);

		const entity = await createEntity(clientB, cookiesB, {
			entitySchemaId,
			name: "User B's Entity",
			image: null,
			properties: { title: "Test Title" },
		});

		// User B tries to remove their entity from User A's collection
		const { response, error } = await clientB.DELETE(
			"/collections/memberships",
			{
				headers: { Cookie: cookiesB },
				body: {
					collectionId: collection.id,
					entityId: entity.id,
				},
			},
		);

		expect(response.status).toBe(404);
		expect(error?.error?.message).toContain("Collection not found");
	});

	it("rejects unauthenticated requests", async () => {
		const { client } = await createAuthenticatedClient();

		const { response } = await client.DELETE("/collections/memberships", {
			body: {
				collectionId: "some-collection-id",
				entityId: "some-entity-id",
			},
		});

		expect(response.status).toBe(401);
	});
});
