import { describe, expect, it } from "bun:test";

import { EntityId } from "@ryot/contract/schema/brands";

import {
	createAuthenticatedClient,
	createCollection,
	createGlobalBookEntityFixture,
	createTrackerWithSchemaAndEntity,
	getBackendClient,
	queryInLibraryRelationship,
} from "~/fixtures";
import { assertTaggedError } from "~/support/assertions";

describe("POST /collections/memberships", () => {
	it("adds a collection entity to another collection", async () => {
		const { client } = await createAuthenticatedClient();

		const parentCollection = await createCollection(client, {
			name: "Parent Collection",
			description: "The parent collection",
		});

		const childCollection = await createCollection(client, {
			name: "Child Collection",
			description: "The child collection to be added",
		});

		const data = await client.run((c) =>
			c.collections.createMembership({
				payload: {
					entityId: childCollection.id,
					collectionId: parentCollection.id,
				},
			}),
		);

		expect(data.memberOf.id).toBeDefined();
		expect(data.memberOf.relationshipSchemaId).toBeDefined();
		expect(data.memberOf.sourceEntityId).toBe(childCollection.id);
		expect(data.memberOf.targetEntityId).toBe(parentCollection.id);
	});

	it("returns validation error when trying to add a collection to itself", async () => {
		const { client } = await createAuthenticatedClient();

		const collection = await createCollection(client, {
			name: "Self-Referencing Collection",
			description: "Should not be able to add to itself",
		});

		const error = await client.runError((c) =>
			c.collections.createMembership({
				payload: { entityId: collection.id, collectionId: collection.id },
			}),
		);

		assertTaggedError(error, "BadRequest");
		expect(error.message).toContain("Cannot add a collection to itself");
	});

	it("adds an entity to a collection", async () => {
		const { client } = await createAuthenticatedClient();

		const collection = await createCollection(client, {
			name: "Test Collection",
			description: "For testing add to collection",
		});

		const { entityId } = await createTrackerWithSchemaAndEntity(client);

		const data = await client.run((c) =>
			c.collections.createMembership({ payload: { entityId, collectionId: collection.id } }),
		);

		expect(data.memberOf.id).toBeDefined();
		expect(data.memberOf.relationshipSchemaId).toBeDefined();
		expect(data.memberOf.sourceEntityId).toBe(entityId);
		expect(data.memberOf.targetEntityId).toBe(collection.id);
	});

	it("adds a global entity to a collection and upserts in_library", async () => {
		const { client, email } = await createAuthenticatedClient();
		const { entity } = await createGlobalBookEntityFixture(client);

		const collection = await createCollection(client, {
			name: "Global Entity Collection",
			description: "For testing global entity membership",
		});

		const data = await client.run((c) =>
			c.collections.createMembership({
				payload: { entityId: entity.id, collectionId: collection.id },
			}),
		);

		expect(data.memberOf.sourceEntityId).toBe(entity.id);
		expect(data.memberOf.targetEntityId).toBe(collection.id);

		const membership = await queryInLibraryRelationship(client, entity.id, email);

		expect(membership.rowCount).toBe(1);
	});

	it("adds an entity with custom properties", async () => {
		const { client } = await createAuthenticatedClient();

		const collection = await createCollection(client, {
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

		const { entityId } = await createTrackerWithSchemaAndEntity(client);

		const data = await client.run((c) =>
			c.collections.createMembership({
				payload: {
					entityId,
					collectionId: collection.id,
					properties: { rating: 5, recommendedBy: "John" },
				},
			}),
		);

		expect(data.memberOf.properties).toMatchObject({
			rating: 5,
			recommendedBy: "John",
		});
	});

	it("fills in defaultValue when a membership property is omitted", async () => {
		const { client } = await createAuthenticatedClient();

		const collection = await createCollection(client, {
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

		const { entityId } = await createTrackerWithSchemaAndEntity(client);

		const data = await client.run((c) =>
			c.collections.createMembership({
				payload: { entityId, properties: { rating: 4 }, collectionId: collection.id },
			}),
		);

		expect(data.memberOf.properties).toMatchObject({ rating: 4, source: "manual" });
	});

	it("upserts an existing membership instead of creating duplicates", async () => {
		const { client } = await createAuthenticatedClient();

		const collection = await createCollection(client, {
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

		const { entityId } = await createTrackerWithSchemaAndEntity(client);

		const first = await client.run((c) =>
			c.collections.createMembership({
				payload: {
					entityId,
					collectionId: collection.id,
					properties: { rating: 4, recommendedBy: "Alice" },
				},
			}),
		);

		const second = await client.run((c) =>
			c.collections.createMembership({
				payload: {
					entityId,
					collectionId: collection.id,
					properties: { rating: 5, recommendedBy: "Bob" },
				},
			}),
		);

		expect(second.memberOf.id).toBe(first.memberOf.id);
		expect(second.memberOf.properties).toMatchObject({
			rating: 5,
			recommendedBy: "Bob",
		});
	});

	it("returns 404 when collection does not exist", async () => {
		const { client } = await createAuthenticatedClient();

		const { entityId } = await createTrackerWithSchemaAndEntity(client);

		const error = await client.runError((c) =>
			c.collections.createMembership({
				payload: { entityId, collectionId: EntityId.make("nonexistent-collection-id") },
			}),
		);

		assertTaggedError(error, "NotFound");
		expect(error.message).toContain("Collection not found");
	});

	it("returns 404 when entity does not exist", async () => {
		const { client } = await createAuthenticatedClient();

		const collection = await createCollection(client, {
			name: "Test Collection",
			description: "For testing add to collection",
		});

		const error = await client.runError((c) =>
			c.collections.createMembership({
				payload: {
					collectionId: collection.id,
					entityId: EntityId.make("nonexistent-entity-id"),
				},
			}),
		);

		assertTaggedError(error, "NotFound");
		expect(error.message).toContain("Entity not found");
	});

	it("returns 404 when trying to add to another user's collection", async () => {
		const { client: clientA } = await createAuthenticatedClient();
		const { client: clientB } = await createAuthenticatedClient();

		const collection = await createCollection(clientA, {
			name: "User A's Private Collection",
			description: "Should not be accessible by User B",
		});

		const { entityId } = await createTrackerWithSchemaAndEntity(clientB);

		const error = await clientB.runError((c) =>
			c.collections.createMembership({ payload: { entityId, collectionId: collection.id } }),
		);

		assertTaggedError(error, "NotFound");
		expect(error.message).toContain("Collection not found");
	});

	it("rejects unauthenticated requests", async () => {
		const client = getBackendClient();

		const error = await client.runError((c) =>
			c.collections.createMembership({
				payload: {
					entityId: EntityId.make("some-entity-id"),
					collectionId: EntityId.make("some-collection-id"),
				},
			}),
		);

		assertTaggedError(error, "Unauthorized");
	});
});

describe("DELETE /collections/memberships", () => {
	it("removes an entity from a collection and deletes the membership", async () => {
		const { client } = await createAuthenticatedClient();

		const collection = await createCollection(client, {
			name: "Test Collection for Removal",
			description: "For testing remove from collection",
		});

		const { entityId } = await createTrackerWithSchemaAndEntity(client);

		const addData = await client.run((c) =>
			c.collections.createMembership({ payload: { entityId, collectionId: collection.id } }),
		);

		expect(addData.memberOf.relationshipSchemaId).toBeDefined();

		const removeData = await client.run((c) =>
			c.collections.deleteMembership({ payload: { entityId, collectionId: collection.id } }),
		);

		expect(removeData.memberOf.relationshipSchemaId).toBeDefined();
		expect(removeData.memberOf.sourceEntityId).toBe(entityId);
		expect(removeData.memberOf.targetEntityId).toBe(collection.id);
	});

	it("returns 404 when removing entity not in collection", async () => {
		const { client } = await createAuthenticatedClient();

		const collection = await createCollection(client, {
			name: "Test Collection",
			description: "For testing remove from collection",
		});

		const { entityId } = await createTrackerWithSchemaAndEntity(client);

		const error = await client.runError((c) =>
			c.collections.deleteMembership({ payload: { entityId, collectionId: collection.id } }),
		);

		assertTaggedError(error, "NotFound");
		expect(error.message).toContain("Entity is not in collection");
	});

	it("returns 404 when collection does not exist", async () => {
		const { client } = await createAuthenticatedClient();

		const { entityId } = await createTrackerWithSchemaAndEntity(client);

		const error = await client.runError((c) =>
			c.collections.deleteMembership({
				payload: { entityId, collectionId: EntityId.make("nonexistent-collection-id") },
			}),
		);

		assertTaggedError(error, "NotFound");
		expect(error.message).toContain("Collection not found");
	});

	it("returns 404 when trying to remove from another user's collection", async () => {
		const { client: clientA } = await createAuthenticatedClient();
		const { client: clientB } = await createAuthenticatedClient();

		const collection = await createCollection(clientA, {
			name: "User A's Private Collection",
			description: "Should not be accessible by User B",
		});

		const { entityId } = await createTrackerWithSchemaAndEntity(clientB);

		const error = await clientB.runError((c) =>
			c.collections.deleteMembership({ payload: { entityId, collectionId: collection.id } }),
		);

		assertTaggedError(error, "NotFound");
		expect(error.message).toContain("Collection not found");
	});

	it("rejects unauthenticated requests", async () => {
		const client = getBackendClient();

		const error = await client.runError((c) =>
			c.collections.deleteMembership({
				payload: {
					entityId: EntityId.make("some-entity-id"),
					collectionId: EntityId.make("some-collection-id"),
				},
			}),
		);

		assertTaggedError(error, "Unauthorized");
	});
});
