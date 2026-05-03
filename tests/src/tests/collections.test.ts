import { describe, expect, it } from "bun:test";

import {
	createAuthenticatedClient,
	createCollection,
	createGlobalBookEntityFixture,
	createTrackerWithSchemaAndEntity,
	listEventsForEntity,
	queryInLibraryRelationship,
	waitForEventWithSchema,
} from "../fixtures";
import { assertTaggedError } from "../test-support/assertions";

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

		const error = await client.runError(
			(c) =>
				c.collections.create({
					payload: {
						name: "Invalid Collection",
						description: "Should fail",
						membershipPropertiesSchema: { fields: { invalidField: { type: "invalid_type" } } },
					},
				}),
			{ Cookie: cookies },
		);

		assertTaggedError(error, "BadRequest");
		expect(error.message).toContain("membershipPropertiesSchema must be a valid AppSchema");
	});

	it("rejects unauthenticated requests", async () => {
		const { client } = await createAuthenticatedClient();

		const error = await client.runError((c) =>
			c.collections.create({
				payload: {
					name: "Test Collection",
					description: "Should fail",
				},
			}),
		);

		assertTaggedError(error, "Unauthorized");
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
							when: { label: "When", description: "When", type: "date" as const },
							where: { label: "Where", description: "Where", type: "string" as const },
							rating: { label: "Rating", description: "Rating", type: "integer" as const },
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
			expect(collection.properties.membershipPropertiesSchema).toEqual(membershipPropertiesSchema);
		});

		it("creates a collection with array item schemas", async () => {
			const { client, cookies } = await createAuthenticatedClient();

			const membershipPropertiesSchema = {
				fields: {
					tags: {
						label: "Tags",
						description: "Tags",
						type: "array" as const,
						items: { label: "Tag", description: "Tag", type: "string" as const },
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
								friend: { label: "Friend", description: "Friend", type: "string" as const },
								context: { label: "Context", description: "Context", type: "string" as const },
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
			expect(collection.properties.membershipPropertiesSchema).toEqual(membershipPropertiesSchema);
		});

		it("rejects collection creation with invalid nested property type", async () => {
			const { client, cookies } = await createAuthenticatedClient();

			const error = await client.runError(
				(c) =>
					c.collections.create({
						payload: {
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
						},
					}),
				{ Cookie: cookies },
			);

			assertTaggedError(error, "BadRequest");
			expect(error.message).toContain("membershipPropertiesSchema must be a valid AppSchema");
		});

		it("rejects collection creation with invalid nested array item type", async () => {
			const { client, cookies } = await createAuthenticatedClient();

			const error = await client.runError(
				(c) =>
					c.collections.create({
						payload: {
							description: "Should fail",
							name: "Invalid Array Collection",
							membershipPropertiesSchema: {
								fields: { tags: { type: "array" as const, items: { type: "unknown_type" } } },
							},
						},
					}),
				{ Cookie: cookies },
			);

			assertTaggedError(error, "BadRequest");
			expect(error.message).toContain("membershipPropertiesSchema must be a valid AppSchema");
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
			expect(collection.properties.membershipPropertiesSchema).toEqual(membershipPropertiesSchema);
		});
	});

	describe("POST /collections/memberships", () => {
		it("adds a collection entity to another collection", async () => {
			const { client, cookies } = await createAuthenticatedClient();

			const parentCollection = await createCollection(client, cookies, {
				name: "Parent Collection",
				description: "The parent collection",
			});

			const childCollection = await createCollection(client, cookies, {
				name: "Child Collection",
				description: "The child collection to be added",
			});

			const data = await client.run(
				(c) =>
					c.collections.createMembership({
						payload: {
							entityId: childCollection.id,
							collectionId: parentCollection.id,
						},
					}),
				{ Cookie: cookies },
			);

			expect(data.memberOf.id).toBeDefined();
			expect(data.memberOf.relationshipSchemaId).toBeDefined();
			expect(data.memberOf.sourceEntityId).toBe(childCollection.id);
			expect(data.memberOf.targetEntityId).toBe(parentCollection.id);
		});

		it("returns validation error when trying to add a collection to itself", async () => {
			const { client, cookies } = await createAuthenticatedClient();

			const collection = await createCollection(client, cookies, {
				name: "Self-Referencing Collection",
				description: "Should not be able to add to itself",
			});

			// Try to add the collection to itself
			const error = await client.runError(
				(c) =>
					c.collections.createMembership({
						payload: { entityId: collection.id, collectionId: collection.id },
					}),
				{ Cookie: cookies },
			);

			assertTaggedError(error, "BadRequest");
			expect(error.message).toContain("Cannot add a collection to itself");
		});

		it("adds an entity to a collection", async () => {
			const { client, cookies } = await createAuthenticatedClient();

			const collection = await createCollection(client, cookies, {
				name: "Test Collection",
				description: "For testing add to collection",
			});

			const { entityId } = await createTrackerWithSchemaAndEntity(client, cookies);

			const data = await client.run(
				(c) =>
					c.collections.createMembership({ payload: { entityId, collectionId: collection.id } }),
				{ Cookie: cookies },
			);

			expect(data.memberOf.id).toBeDefined();
			expect(data.memberOf.relationshipSchemaId).toBeDefined();
			expect(data.memberOf.sourceEntityId).toBe(entityId);
			expect(data.memberOf.targetEntityId).toBe(collection.id);
		});

		it("adds a global entity to a collection and upserts in_library", async () => {
			const { client, cookies, email } = await createAuthenticatedClient();
			const { entity } = await createGlobalBookEntityFixture(client, cookies);

			const collection = await createCollection(client, cookies, {
				name: "Global Entity Collection",
				description: "For testing global entity membership",
			});

			const data = await client.run(
				(c) =>
					c.collections.createMembership({
						payload: { entityId: entity.id, collectionId: collection.id },
					}),
				{ Cookie: cookies },
			);

			expect(data.memberOf.sourceEntityId).toBe(entity.id);
			expect(data.memberOf.targetEntityId).toBe(collection.id);

			const membership = await queryInLibraryRelationship(entity.id, email);

			expect(membership.rowCount).toBe(1);
		});

		it("adds an entity with custom properties", async () => {
			const { client, cookies } = await createAuthenticatedClient();

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

			const { entityId } = await createTrackerWithSchemaAndEntity(client, cookies);

			const data = await client.run(
				(c) =>
					c.collections.createMembership({
						payload: {
							entityId,
							collectionId: collection.id,
							properties: { rating: 5, recommendedBy: "John" },
						},
					}),
				{ Cookie: cookies },
			);

			expect(data.memberOf.properties).toMatchObject({
				rating: 5,
				recommendedBy: "John",
			});
		});

		it("fills in defaultValue when a membership property is omitted", async () => {
			const { client, cookies } = await createAuthenticatedClient();

			const collection = await createCollection(client, cookies, {
				name: "Movies with source tracking",
				description: "Track how movies were added",
				membershipPropertiesSchema: {
					fields: {
						rating: { type: "integer", label: "Rating", description: "Rating" },
						source: {
							type: "string",
							label: "Source",
							defaultValue: "manual",
							description: "How this was added",
						},
					},
				},
			});

			const { entityId } = await createTrackerWithSchemaAndEntity(client, cookies);

			const data = await client.run(
				(c) =>
					c.collections.createMembership({
						payload: { entityId, properties: { rating: 4 }, collectionId: collection.id },
					}),
				{ Cookie: cookies },
			);

			expect(data.memberOf.properties).toMatchObject({ rating: 4, source: "manual" });
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

			const { entityId } = await createTrackerWithSchemaAndEntity(client, cookies);

			const first = await client.run(
				(c) =>
					c.collections.createMembership({
						payload: {
							entityId,
							collectionId: collection.id,
							properties: { rating: 4, recommendedBy: "Alice" },
						},
					}),
				{ Cookie: cookies },
			);

			const second = await client.run(
				(c) =>
					c.collections.createMembership({
						payload: {
							entityId,
							collectionId: collection.id,
							properties: { rating: 5, recommendedBy: "Bob" },
						},
					}),
				{ Cookie: cookies },
			);

			expect(second.memberOf.id).toBe(first.memberOf.id);
			expect(second.memberOf.properties).toMatchObject({
				rating: 5,
				recommendedBy: "Bob",
			});
		});

		it("returns 404 when collection does not exist", async () => {
			const { client, cookies } = await createAuthenticatedClient();

			const { entityId } = await createTrackerWithSchemaAndEntity(client, cookies);

			const error = await client.runError(
				(c) =>
					c.collections.createMembership({
						payload: { entityId, collectionId: "nonexistent-collection-id" },
					}),
				{ Cookie: cookies },
			);

			assertTaggedError(error, "NotFound");
			expect(error.message).toContain("Collection not found");
		});

		it("returns 404 when entity does not exist", async () => {
			const { client, cookies } = await createAuthenticatedClient();

			const collection = await createCollection(client, cookies, {
				name: "Test Collection",
				description: "For testing add to collection",
			});

			const error = await client.runError(
				(c) =>
					c.collections.createMembership({
						payload: { collectionId: collection.id, entityId: "nonexistent-entity-id" },
					}),
				{ Cookie: cookies },
			);

			assertTaggedError(error, "NotFound");
			expect(error.message).toContain("Entity not found");
		});

		it("returns 404 when trying to add to another user's collection", async () => {
			const { client: clientA, cookies: cookiesA } = await createAuthenticatedClient();
			const { client: clientB, cookies: cookiesB } = await createAuthenticatedClient();

			const collection = await createCollection(clientA, cookiesA, {
				name: "User A's Private Collection",
				description: "Should not be accessible by User B",
			});

			const { entityId } = await createTrackerWithSchemaAndEntity(clientB, cookiesB);

			const error = await clientB.runError(
				(c) =>
					c.collections.createMembership({ payload: { entityId, collectionId: collection.id } }),
				{ Cookie: cookiesB },
			);

			assertTaggedError(error, "NotFound");
			expect(error.message).toContain("Collection not found");
		});

		it("rejects unauthenticated requests", async () => {
			const { client } = await createAuthenticatedClient();

			const error = await client.runError((c) =>
				c.collections.createMembership({
					payload: { entityId: "some-entity-id", collectionId: "some-collection-id" },
				}),
			);

			assertTaggedError(error, "Unauthorized");
		});
	});

	it("removes an entity from a collection and deletes the membership", async () => {
		const { client, cookies } = await createAuthenticatedClient();

		const collection = await createCollection(client, cookies, {
			name: "Test Collection for Removal",
			description: "For testing remove from collection",
		});

		const { entityId } = await createTrackerWithSchemaAndEntity(client, cookies);

		const addData = await client.run(
			(c) => c.collections.createMembership({ payload: { entityId, collectionId: collection.id } }),
			{ Cookie: cookies },
		);

		expect(addData.memberOf.relationshipSchemaId).toBeDefined();

		const removeData = await client.run(
			(c) => c.collections.deleteMembership({ payload: { entityId, collectionId: collection.id } }),
			{ Cookie: cookies },
		);

		expect(removeData.memberOf.relationshipSchemaId).toBeDefined();
		expect(removeData.memberOf.sourceEntityId).toBe(entityId);
		expect(removeData.memberOf.targetEntityId).toBe(collection.id);
	});

	it("returns 404 when removing entity not in collection", async () => {
		const { client, cookies } = await createAuthenticatedClient();

		const collection = await createCollection(client, cookies, {
			name: "Test Collection",
			description: "For testing remove from collection",
		});

		const { entityId } = await createTrackerWithSchemaAndEntity(client, cookies);

		const error = await client.runError(
			(c) => c.collections.deleteMembership({ payload: { entityId, collectionId: collection.id } }),
			{ Cookie: cookies },
		);

		assertTaggedError(error, "NotFound");
		expect(error.message).toContain("Entity is not in collection");
	});

	it("returns 404 when collection does not exist", async () => {
		const { client, cookies } = await createAuthenticatedClient();

		const { entityId } = await createTrackerWithSchemaAndEntity(client, cookies);

		const error = await client.runError(
			(c) =>
				c.collections.deleteMembership({
					payload: { entityId, collectionId: "nonexistent-collection-id" },
				}),
			{ Cookie: cookies },
		);

		assertTaggedError(error, "NotFound");
		expect(error.message).toContain("Collection not found");
	});

	it("returns 404 when trying to remove from another user's collection", async () => {
		const { client: clientA, cookies: cookiesA } = await createAuthenticatedClient();
		const { client: clientB, cookies: cookiesB } = await createAuthenticatedClient();

		const collection = await createCollection(clientA, cookiesA, {
			name: "User A's Private Collection",
			description: "Should not be accessible by User B",
		});

		const { entityId } = await createTrackerWithSchemaAndEntity(clientB, cookiesB);

		const error = await clientB.runError(
			(c) => c.collections.deleteMembership({ payload: { entityId, collectionId: collection.id } }),
			{ Cookie: cookiesB },
		);

		assertTaggedError(error, "NotFound");
		expect(error.message).toContain("Collection not found");
	});

	it("rejects unauthenticated requests", async () => {
		const { client } = await createAuthenticatedClient();

		const error = await client.runError((c) =>
			c.collections.deleteMembership({
				payload: { entityId: "some-entity-id", collectionId: "some-collection-id" },
			}),
		);

		assertTaggedError(error, "Unauthorized");
	});
});

describe("collection events", () => {
	it("add-entity-to-collection event is created on first add with correct properties", async () => {
		const { client, cookies } = await createAuthenticatedClient();

		const collection = await createCollection(client, cookies, { name: "Event Test Collection" });
		const { entityId } = await createTrackerWithSchemaAndEntity(client, cookies);

		const addData = await client.run(
			(c) => c.collections.createMembership({ payload: { entityId, collectionId: collection.id } }),
			{ Cookie: cookies },
		);

		const relationshipId = addData.memberOf.id;
		await waitForEventWithSchema(client, cookies, collection.id, "add-entity-to-collection");

		const events = await listEventsForEntity(client, cookies, collection.id);
		const addEvents = events.filter((e) => e.eventSchemaSlug === "add-entity-to-collection");

		expect(addEvents).toHaveLength(1);
		expect(addEvents[0]?.properties).toMatchObject({
			entityId,
			relationshipId,
		});
		expect(addEvents[0]?.properties.entitySchemaSlug).toBeDefined();
	});

	it("second add to same collection (upsert) does not create a second event", async () => {
		const { client, cookies } = await createAuthenticatedClient();

		const collection = await createCollection(client, cookies, { name: "Upsert Event Collection" });
		const { entityId } = await createTrackerWithSchemaAndEntity(client, cookies);

		await client.run(
			(c) => c.collections.createMembership({ payload: { entityId, collectionId: collection.id } }),
			{ Cookie: cookies },
		);

		await client.run(
			(c) => c.collections.createMembership({ payload: { entityId, collectionId: collection.id } }),
			{ Cookie: cookies },
		);

		await waitForEventWithSchema(client, cookies, collection.id, "add-entity-to-collection");

		const events = await listEventsForEntity(client, cookies, collection.id);
		const addEvents = events.filter((e) => e.eventSchemaSlug === "add-entity-to-collection");

		expect(addEvents).toHaveLength(1);
	});

	it("remove-entity-from-collection event is created on remove with correct properties", async () => {
		const { client, cookies } = await createAuthenticatedClient();

		const collection = await createCollection(client, cookies, { name: "Remove Event Collection" });
		const { entityId } = await createTrackerWithSchemaAndEntity(client, cookies);

		const addData = await client.run(
			(c) => c.collections.createMembership({ payload: { entityId, collectionId: collection.id } }),
			{ Cookie: cookies },
		);
		const relationshipId = addData.memberOf.id;

		await client.run(
			(c) => c.collections.deleteMembership({ payload: { entityId, collectionId: collection.id } }),
			{ Cookie: cookies },
		);

		await waitForEventWithSchema(client, cookies, collection.id, "remove-entity-from-collection");

		const events = await listEventsForEntity(client, cookies, collection.id);
		const removeEvents = events.filter(
			(e) => e.eventSchemaSlug === "remove-entity-from-collection",
		);

		expect(removeEvents).toHaveLength(1);
		expect(removeEvents[0]?.properties).toMatchObject({
			entityId,
			relationshipId,
		});
		expect(removeEvents[0]?.properties.entitySchemaSlug).toBeDefined();
	});

	it("removing an entity not in the collection does not create a remove event", async () => {
		const { client, cookies } = await createAuthenticatedClient();

		const collection = await createCollection(client, cookies, {
			name: "No Remove Event Collection",
		});
		const { entityId } = await createTrackerWithSchemaAndEntity(client, cookies);

		const error = await client.runError(
			(c) => c.collections.deleteMembership({ payload: { entityId, collectionId: collection.id } }),
			{ Cookie: cookies },
		);

		assertTaggedError(error, "NotFound");

		const events = await listEventsForEntity(client, cookies, collection.id);
		const removeEvents = events.filter(
			(e) => e.eventSchemaSlug === "remove-entity-from-collection",
		);

		expect(removeEvents).toHaveLength(0);
	});
});
