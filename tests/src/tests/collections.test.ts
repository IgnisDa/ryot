import { describe, expect, it } from "bun:test";
import {
	createAuthenticatedClient,
	createCollection,
	createTrackerWithSchemaAndEntity,
	findBuiltinSchemaWithProviders,
	getFirstProviderScriptId,
	queryInLibraryRelationship,
	seedMediaEntity,
} from "../fixtures";

describe("POST /collections", () => {
	it("creates a collection with valid membershipPropertiesSchema", async () => {
		const { client, cookies } = await createAuthenticatedClient();

		const membershipPropertiesSchema = {
			fields: {
				friendWhoRecommendedIt: {
					type: "string" as const,
					label: "Friend Who Recommended It",
					description: "Friend Who Recommended It",
				},
				whereTheyRecommendedIt: {
					type: "string" as const,
					label: "Where They Recommended It",
					description: "Where They Recommended It",
				},
			},
		};

		const collection = await createCollection(client, cookies, {
			name: "Recommended to me",
			membershipPropertiesSchema,
			description: "Movies and books recommended by friends",
		});

		expect(collection.id).toBeDefined();
		expect(collection.name).toBe("Recommended to me");
		expect(collection.properties).toMatchObject({
			membershipPropertiesSchema,
			description: "Movies and books recommended by friends",
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
					fields: { invalidField: { type: "invalid_type" } },
				},
			} as unknown as { name: string; description?: string },
		});

		expect(response.status).toBe(400);
		expect(error?.error?.message).toContain("Invalid input");
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

	describe("nested membershipPropertiesSchema validation", () => {
		it("creates a collection with deeply nested object properties", async () => {
			const { client, cookies } = await createAuthenticatedClient();

			const membershipPropertiesSchema = {
				fields: {
					friendWhoRecommendedIt: {
						type: "string" as const,
						label: "Friend Who Recommended It",
						description: "Friend Who Recommended It",
					},
					recommendationDetails: {
						type: "object" as const,
						label: "Recommendation Details",
						description: "Recommendation Details",
						properties: {
							when: {
								type: "date" as const,
								label: "When",
								description: "When",
							},
							where: {
								type: "string" as const,
								label: "Where",
								description: "Where",
							},
							rating: {
								type: "integer" as const,
								label: "Rating",
								description: "Rating",
							},
						},
					},
				},
			};

			const collection = await createCollection(client, cookies, {
				membershipPropertiesSchema,
				name: "Nested Schema Collection",
				description: "Testing nested properties",
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
						label: "Tags",
						description: "Tags",
						items: {
							type: "string" as const,
							label: "Tag",
							description: "Tag",
						},
					},
					recommendations: {
						type: "array" as const,
						label: "Recommendations",
						description: "Recommendations",
						items: {
							type: "object" as const,
							label: "Recommendation",
							description: "Recommendation",
							properties: {
								friend: {
									type: "string" as const,
									label: "Friend",
									description: "Friend",
								},
								context: {
									type: "string" as const,
									label: "Context",
									description: "Context",
								},
							},
						},
					},
				},
			};

			const collection = await createCollection(client, cookies, {
				membershipPropertiesSchema,
				name: "Array Schema Collection",
				description: "Testing array item schemas",
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
					description: "Should fail",
					name: "Invalid Nested Collection",
					membershipPropertiesSchema: {
						fields: {
							nested: {
								type: "object" as const,
								properties: { invalidField: { type: "unknown_type" } },
							},
						},
					},
				} as unknown as { name: string; description?: string },
			});

			expect(response.status).toBe(400);
			expect(error?.error?.message).toContain(
				"membershipPropertiesSchema must be a valid AppSchema",
			);
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
			expect(error?.error?.message).toContain(
				"membershipPropertiesSchema must be a valid AppSchema",
			);
		});

		it("creates a collection with multi-level nested schema", async () => {
			const { client, cookies } = await createAuthenticatedClient();

			const membershipPropertiesSchema = {
				fields: {
					priority: {
						type: "integer" as const,
						label: "Priority",
						description: "Priority",
					},
					metadata: {
						label: "Metadata",
						description: "Metadata",
						type: "object" as const,
						properties: {
							source: {
								label: "Source",
								description: "Source",
								type: "object" as const,
								properties: {
									url: {
										type: "string" as const,
										label: "URL",
										description: "URL",
									},
									name: {
										type: "string" as const,
										label: "Name",
										description: "Name",
									},
								},
							},
							tags: {
								label: "Tags",
								description: "Tags",
								type: "array" as const,
								items: {
									type: "object" as const,
									label: "Tag",
									description: "Tag",
									properties: {
										label: {
											type: "string" as const,
											label: "Label",
											description: "Label",
										},
										color: {
											type: "string" as const,
											label: "Color",
											description: "Color",
										},
									},
								},
							},
						},
					},
				},
			};

			const collection = await createCollection(client, cookies, {
				membershipPropertiesSchema,
				name: "Complex Nested Collection",
				description: "Testing multi-level nesting",
			});

			expect(collection.id).toBeDefined();
			expect(collection.properties.membershipPropertiesSchema).toEqual(
				membershipPropertiesSchema,
			);
		});
	});

	describe("POST /collections/memberships", () => {
		it("adds a collection entity to another collection", async () => {
			const { client, cookies } = await createAuthenticatedClient();

			// Create two collections
			const parentCollection = await createCollection(client, cookies, {
				name: "Parent Collection",
				description: "The parent collection",
			});

			const childCollection = await createCollection(client, cookies, {
				name: "Child Collection",
				description: "The child collection to be added",
			});

			// Add child collection to parent collection
			const { data, response } = await client.POST("/collections/memberships", {
				headers: { Cookie: cookies },
				body: {
					entityId: childCollection.id,
					collectionId: parentCollection.id,
				},
			});

			expect(response.status).toBe(200);
			expect(data?.data?.memberOf?.id).toBeDefined();
			expect(data?.data?.memberOf?.relationshipSchemaId).toBeDefined();
			expect(data?.data?.memberOf?.sourceEntityId).toBe(childCollection.id);
			expect(data?.data?.memberOf?.targetEntityId).toBe(parentCollection.id);
		});

		it("returns validation error when trying to add a collection to itself", async () => {
			const { client, cookies } = await createAuthenticatedClient();

			// Create a collection
			const collection = await createCollection(client, cookies, {
				name: "Self-Referencing Collection",
				description: "Should not be able to add to itself",
			});

			// Try to add the collection to itself
			const { response, error } = await client.POST(
				"/collections/memberships",
				{
					headers: { Cookie: cookies },
					body: { entityId: collection.id, collectionId: collection.id },
				},
			);

			expect(response.status).toBe(400);
			expect(error?.error?.message).toContain(
				"Cannot add a collection to itself",
			);
		});

		it("adds an entity to a collection", async () => {
			const { client, cookies } = await createAuthenticatedClient();

			// Create a collection
			const collection = await createCollection(client, cookies, {
				name: "Test Collection",
				description: "For testing add to collection",
			});

			// Create a tracker, schema, and entity
			const { entityId } = await createTrackerWithSchemaAndEntity(
				client,
				cookies,
			);

			// Add entity to collection
			const { data, response } = await client.POST("/collections/memberships", {
				headers: { Cookie: cookies },
				body: { entityId, collectionId: collection.id },
			});

			expect(response.status).toBe(200);
			expect(data?.data?.memberOf?.id).toBeDefined();
			expect(data?.data?.memberOf?.relationshipSchemaId).toBeDefined();
			expect(data?.data?.memberOf?.sourceEntityId).toBe(entityId);
			expect(data?.data?.memberOf?.targetEntityId).toBe(collection.id);
		});

		it("adds a global entity to a collection and upserts in_library", async () => {
			const { client, cookies, email } = await createAuthenticatedClient();
			const { schema } = await findBuiltinSchemaWithProviders(client, cookies);
			const providerScriptId = getFirstProviderScriptId(schema);

			const entity = await seedMediaEntity({
				image: null,
				userId: null,
				properties: {},
				entitySchemaId: schema.id,
				sandboxScriptId: providerScriptId,
				externalId: `global-entity-${crypto.randomUUID()}`,
				name: `Global Built-in Entity ${crypto.randomUUID()}`,
			});

			const collection = await createCollection(client, cookies, {
				name: "Global Entity Collection",
				description: "For testing global entity membership",
			});

			const { data, response } = await client.POST("/collections/memberships", {
				headers: { Cookie: cookies },
				body: { entityId: entity.id, collectionId: collection.id },
			});

			expect(response.status).toBe(200);
			expect(data?.data?.memberOf?.sourceEntityId).toBe(entity.id);
			expect(data?.data?.memberOf?.targetEntityId).toBe(collection.id);

			const membership = await queryInLibraryRelationship(entity.id, email);

			expect(membership.rowCount).toBe(1);
		});

		it("adds an entity with custom properties", async () => {
			const { client, cookies } = await createAuthenticatedClient();

			// Create a collection with membershipPropertiesSchema
			const collection = await createCollection(client, cookies, {
				name: "Movies with metadata",
				description: "Movies with recommendation info",
				membershipPropertiesSchema: {
					fields: {
						rating: { type: "integer", label: "Rating", description: "Rating" },
						recommendedBy: {
							type: "string",
							label: "Recommended By",
							description: "Recommended By",
						},
					},
				},
			});

			// Create a tracker, schema, and entity
			const { entityId } = await createTrackerWithSchemaAndEntity(
				client,
				cookies,
			);

			// Add entity to collection with custom properties
			const { data, response } = await client.POST("/collections/memberships", {
				headers: { Cookie: cookies },
				body: {
					entityId,
					collectionId: collection.id,
					properties: { rating: 5, recommendedBy: "John" },
				},
			});

			expect(response.status).toBe(200);
			expect(data?.data?.memberOf?.properties).toMatchObject({
				rating: 5,
				recommendedBy: "John",
			});
		});

		it("upserts an existing membership instead of creating duplicates", async () => {
			const { client, cookies } = await createAuthenticatedClient();

			const collection = await createCollection(client, cookies, {
				name: "Upsert Collection",
				membershipPropertiesSchema: {
					fields: {
						rating: { type: "integer", label: "Rating", description: "Rating" },
						recommendedBy: {
							type: "string",
							label: "Recommended By",
							description: "Recommended By",
						},
					},
				},
			});

			const { entityId } = await createTrackerWithSchemaAndEntity(
				client,
				cookies,
			);

			const first = await client.POST("/collections/memberships", {
				headers: { Cookie: cookies },
				body: {
					entityId,
					collectionId: collection.id,
					properties: { rating: 4, recommendedBy: "Alice" },
				},
			});

			const second = await client.POST("/collections/memberships", {
				headers: { Cookie: cookies },
				body: {
					entityId,
					collectionId: collection.id,
					properties: { rating: 5, recommendedBy: "Bob" },
				},
			});

			expect(first.response.status).toBe(200);
			expect(second.response.status).toBe(200);
			expect(second.data?.data?.memberOf?.id).toBe(
				first.data?.data?.memberOf?.id,
			);
			expect(second.data?.data?.memberOf?.properties).toMatchObject({
				rating: 5,
				recommendedBy: "Bob",
			});
		});

		it("returns 404 when collection does not exist", async () => {
			const { client, cookies } = await createAuthenticatedClient();

			// Create a tracker and entity
			const { entityId } = await createTrackerWithSchemaAndEntity(
				client,
				cookies,
			);

			// Try to add to non-existent collection
			const { response, error } = await client.POST(
				"/collections/memberships",
				{
					headers: { Cookie: cookies },
					body: {
						entityId,
						collectionId: "nonexistent-collection-id",
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

			// User B creates a tracker, schema, and entity
			const { entityId } = await createTrackerWithSchemaAndEntity(
				clientB,
				cookiesB,
			);

			// User B tries to add their entity to User A's collection
			const { response, error } = await clientB.POST(
				"/collections/memberships",
				{
					headers: { Cookie: cookiesB },
					body: { entityId, collectionId: collection.id },
				},
			);

			expect(response.status).toBe(404);
			expect(error?.error?.message).toContain("Collection not found");
		});

		it("rejects unauthenticated requests", async () => {
			const { client } = await createAuthenticatedClient();

			const { response } = await client.POST("/collections/memberships", {
				body: {
					entityId: "some-entity-id",
					collectionId: "some-collection-id",
				},
			});

			expect(response.status).toBe(401);
		});
	});

	it("removes an entity from a collection and deletes the membership", async () => {
		const { client, cookies } = await createAuthenticatedClient();

		// Create a collection
		const collection = await createCollection(client, cookies, {
			name: "Test Collection for Removal",
			description: "For testing remove from collection",
		});

		// Create a tracker, schema, and entity
		const { entityId } = await createTrackerWithSchemaAndEntity(
			client,
			cookies,
		);

		// Add entity to collection first
		const { data: addData, response: addResponse } = await client.POST(
			"/collections/memberships",
			{
				headers: { Cookie: cookies },
				body: { entityId, collectionId: collection.id },
			},
		);

		expect(addResponse.status).toBe(200);
		expect(addData?.data?.memberOf?.relationshipSchemaId).toBeDefined();

		// Now remove the entity from the collection
		const { data: removeData, response: removeResponse } = await client.DELETE(
			"/collections/memberships",
			{
				headers: { Cookie: cookies },
				body: { entityId, collectionId: collection.id },
			},
		);

		expect(removeResponse.status).toBe(200);
		expect(removeData?.data?.memberOf?.relationshipSchemaId).toBeDefined();
		expect(removeData?.data?.memberOf?.sourceEntityId).toBe(entityId);
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
		const { entityId } = await createTrackerWithSchemaAndEntity(
			client,
			cookies,
		);

		// Try to remove entity that was never added to collection
		const { response, error } = await client.DELETE(
			"/collections/memberships",
			{
				headers: { Cookie: cookies },
				body: { entityId, collectionId: collection.id },
			},
		);

		expect(response.status).toBe(404);
		expect(error?.error?.message).toContain("Entity is not in collection");
	});

	it("returns 404 when collection does not exist", async () => {
		const { client, cookies } = await createAuthenticatedClient();

		// Create an entity
		const { entityId } = await createTrackerWithSchemaAndEntity(
			client,
			cookies,
		);

		// Try to remove from non-existent collection
		const { response, error } = await client.DELETE(
			"/collections/memberships",
			{
				headers: { Cookie: cookies },
				body: {
					entityId,
					collectionId: "nonexistent-collection-id",
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

		// User B creates a tracker, schema, and entity
		const { entityId } = await createTrackerWithSchemaAndEntity(
			clientB,
			cookiesB,
		);

		// User B tries to remove their entity from User A's collection
		const { response, error } = await clientB.DELETE(
			"/collections/memberships",
			{
				headers: { Cookie: cookiesB },
				body: { entityId, collectionId: collection.id },
			},
		);

		expect(response.status).toBe(404);
		expect(error?.error?.message).toContain("Collection not found");
	});

	it("rejects unauthenticated requests", async () => {
		const { client } = await createAuthenticatedClient();

		const { response } = await client.DELETE("/collections/memberships", {
			body: {
				entityId: "some-entity-id",
				collectionId: "some-collection-id",
			},
		});

		expect(response.status).toBe(401);
	});
});
