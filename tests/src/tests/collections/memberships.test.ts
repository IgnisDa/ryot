import { EntityId } from "@ryot/contract/schema/brands";
import { Effect } from "effect";

import {
	createAuthenticatedClient,
	createCollection,
	createGlobalBookEntityFixture,
	createPluginSchema,
	createPluginSchemaAndEntity,
	findBuiltinSchemaBySlug,
	getBackendClient,
	queryInLibraryRelationship,
	seedMediaEntity,
} from "~/fixtures";
import { assertTaggedError } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

describe("POST /collections/memberships", () => {
	it.live("adds a collection entity to another collection", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();

			const parentCollection = yield* createCollection(client, {
				name: "Parent Collection",
				description: "The parent collection",
			});

			const childCollection = yield* createCollection(client, {
				name: "Child Collection",
				description: "The child collection to be added",
			});

			const data = yield* client.call((c) =>
				c.collections.createMembership({
					payload: {
						entityId: childCollection.id,
						collectionId: parentCollection.id,
					},
				}),
			);

			expect(data.memberOf.id).toBeDefined();
			expect(data.memberOf.relationshipSchemaSlug).toBeDefined();
			expect(data.memberOf.sourceEntityId).toBe(childCollection.id);
			expect(data.memberOf.targetEntityId).toBe(parentCollection.id);
		}),
	);

	it.live("returns validation error when trying to add a collection to itself", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();

			const collection = yield* createCollection(client, {
				name: "Self-Referencing Collection",
				description: "Should not be able to add to itself",
			});

			const error = yield* Effect.flip(
				client.call((c) =>
					c.collections.createMembership({
						payload: { entityId: collection.id, collectionId: collection.id },
					}),
				),
			);

			assertTaggedError(error, "BadRequest");
			expect(error.message).toContain("Cannot add a collection to itself");
		}),
	);

	it.live("adds an entity to a collection", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();

			const collection = yield* createCollection(client, {
				name: "Test Collection",
				description: "For testing add to collection",
			});

			const { entityId } = yield* createPluginSchemaAndEntity(client);

			const data = yield* client.call((c) =>
				c.collections.createMembership({ payload: { entityId, collectionId: collection.id } }),
			);

			expect(data.memberOf.id).toBeDefined();
			expect(data.memberOf.relationshipSchemaSlug).toBeDefined();
			expect(data.memberOf.sourceEntityId).toBe(entityId);
			expect(data.memberOf.targetEntityId).toBe(collection.id);
		}),
	);

	it.live("adds a global entity to a collection and upserts in_library", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { entity, schema } = yield* createGlobalBookEntityFixture(client);

			const collection = yield* createCollection(client, {
				name: "Global Entity Collection",
				description: "For testing global entity membership",
			});

			const data = yield* client.call((c) =>
				c.collections.createMembership({
					payload: { entityId: entity.id, collectionId: collection.id },
				}),
			);

			expect(data.memberOf.sourceEntityId).toBe(entity.id);
			expect(data.memberOf.targetEntityId).toBe(collection.id);

			const membership = yield* queryInLibraryRelationship(client, entity.id, schema.slug);

			expect(membership.data.items).toHaveLength(1);
		}),
	);

	it.live("does not add a global fitness entity to the media library", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schema } = yield* findBuiltinSchemaBySlug(client, "workout");
			const entity = yield* seedMediaEntity({
				userId: null,
				providerId: null,
				entitySchemaSlug: schema.id,
				name: `Global Workout ${crypto.randomUUID()}`,
				externalId: `global-workout-${crypto.randomUUID()}`,
				properties: { endedAt: "2026-04-27T11:00:00Z", startedAt: "2026-04-27T10:00:00Z" },
			});
			const collection = yield* createCollection(client, { name: "Fitness Collection" });

			yield* client.call((c) =>
				c.collections.createMembership({
					payload: { entityId: entity.id, collectionId: collection.id },
				}),
			);

			const membership = yield* queryInLibraryRelationship(client, entity.id, schema.slug);
			expect(membership.data.items).toHaveLength(0);
		}),
	);

	it.live("does not add an unrelated global plugin entity to the media library", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { slug, schemaId } = yield* createPluginSchema(client);
			const entity = yield* seedMediaEntity({
				userId: null,
				providerId: null,
				entitySchemaSlug: schemaId,
				properties: { title: "Unrelated" },
				name: `Global Fixture ${crypto.randomUUID()}`,
				externalId: `global-fixture-${crypto.randomUUID()}`,
			});
			const collection = yield* createCollection(client, { name: "Fixture Collection" });

			yield* client.call((c) =>
				c.collections.createMembership({
					payload: { entityId: entity.id, collectionId: collection.id },
				}),
			);

			const membership = yield* queryInLibraryRelationship(client, entity.id, slug);
			expect(membership.data.items).toHaveLength(0);
		}),
	);

	it.live("adds an entity with custom properties", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();

			const collection = yield* createCollection(client, {
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

			const { entityId } = yield* createPluginSchemaAndEntity(client);

			const data = yield* client.call((c) =>
				c.collections.createMembership({
					payload: {
						entityId,
						collectionId: collection.id,
						properties: { rating: 5, recommendedBy: "John" },
					},
				}),
			);

			expect(data.memberOf.properties).toMatchObject({ rating: 5, recommendedBy: "John" });
		}),
	);

	it.live("fills in defaultValue when a membership property is omitted", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();

			const collection = yield* createCollection(client, {
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

			const { entityId } = yield* createPluginSchemaAndEntity(client);

			const data = yield* client.call((c) =>
				c.collections.createMembership({
					payload: { entityId, properties: { rating: 4 }, collectionId: collection.id },
				}),
			);

			expect(data.memberOf.properties).toMatchObject({ rating: 4, source: "manual" });
		}),
	);

	it.live("upserts an existing membership instead of creating duplicates", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();

			const collection = yield* createCollection(client, {
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

			const { entityId } = yield* createPluginSchemaAndEntity(client);

			const first = yield* client.call((c) =>
				c.collections.createMembership({
					payload: {
						entityId,
						collectionId: collection.id,
						properties: { rating: 4, recommendedBy: "Alice" },
					},
				}),
			);

			const second = yield* client.call((c) =>
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
		}),
	);

	it.live("returns 404 when collection does not exist", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();

			const { entityId } = yield* createPluginSchemaAndEntity(client);

			const error = yield* Effect.flip(
				client.call((c) =>
					c.collections.createMembership({
						payload: { entityId, collectionId: EntityId.make("nonexistent-collection-id") },
					}),
				),
			);

			assertTaggedError(error, "NotFound");
			expect(error.message).toContain("Collection not found");
		}),
	);

	it.live("returns 404 when entity does not exist", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();

			const collection = yield* createCollection(client, {
				name: "Test Collection",
				description: "For testing add to collection",
			});

			const error = yield* Effect.flip(
				client.call((c) =>
					c.collections.createMembership({
						payload: {
							collectionId: collection.id,
							entityId: EntityId.make("nonexistent-entity-id"),
						},
					}),
				),
			);

			assertTaggedError(error, "NotFound");
			expect(error.message).toContain("Entity not found");
		}),
	);

	it.live("returns 404 when trying to add to another user's collection", () =>
		Effect.gen(function* () {
			const { client: clientA } = yield* createAuthenticatedClient();
			const { client: clientB } = yield* createAuthenticatedClient();

			const collection = yield* createCollection(clientA, {
				name: "User A's Private Collection",
				description: "Should not be accessible by User B",
			});

			const { entityId } = yield* createPluginSchemaAndEntity(clientB);

			const error = yield* Effect.flip(
				clientB.call((c) =>
					c.collections.createMembership({ payload: { entityId, collectionId: collection.id } }),
				),
			);

			assertTaggedError(error, "NotFound");
			expect(error.message).toContain("Collection not found");
		}),
	);

	it.live("rejects unauthenticated requests", () =>
		Effect.gen(function* () {
			const client = getBackendClient();

			const error = yield* Effect.flip(
				client.call((c) =>
					c.collections.createMembership({
						payload: {
							entityId: EntityId.make("some-entity-id"),
							collectionId: EntityId.make("some-collection-id"),
						},
					}),
				),
			);

			assertTaggedError(error, "Unauthorized");
		}),
	);
});

describe("DELETE /collections/memberships", () => {
	it.live("removes an entity from a collection and deletes the membership", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();

			const collection = yield* createCollection(client, {
				name: "Test Collection for Removal",
				description: "For testing remove from collection",
			});

			const { entityId } = yield* createPluginSchemaAndEntity(client);

			const addData = yield* client.call((c) =>
				c.collections.createMembership({ payload: { entityId, collectionId: collection.id } }),
			);

			expect(addData.memberOf.relationshipSchemaSlug).toBeDefined();

			const removeData = yield* client.call((c) =>
				c.collections.deleteMembership({ payload: { entityId, collectionId: collection.id } }),
			);

			expect(removeData.memberOf.relationshipSchemaSlug).toBeDefined();
			expect(removeData.memberOf.sourceEntityId).toBe(entityId);
			expect(removeData.memberOf.targetEntityId).toBe(collection.id);
		}),
	);

	it.live("returns 404 when removing entity not in collection", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();

			const collection = yield* createCollection(client, {
				name: "Test Collection",
				description: "For testing remove from collection",
			});

			const { entityId } = yield* createPluginSchemaAndEntity(client);

			const error = yield* Effect.flip(
				client.call((c) =>
					c.collections.deleteMembership({ payload: { entityId, collectionId: collection.id } }),
				),
			);

			assertTaggedError(error, "NotFound");
			expect(error.message).toContain("Entity is not in collection");
		}),
	);

	it.live("returns 404 when collection does not exist", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();

			const { entityId } = yield* createPluginSchemaAndEntity(client);

			const error = yield* Effect.flip(
				client.call((c) =>
					c.collections.deleteMembership({
						payload: { entityId, collectionId: EntityId.make("nonexistent-collection-id") },
					}),
				),
			);

			assertTaggedError(error, "NotFound");
			expect(error.message).toContain("Collection not found");
		}),
	);

	it.live("returns 404 when trying to remove from another user's collection", () =>
		Effect.gen(function* () {
			const { client: clientA } = yield* createAuthenticatedClient();
			const { client: clientB } = yield* createAuthenticatedClient();

			const collection = yield* createCollection(clientA, {
				name: "User A's Private Collection",
				description: "Should not be accessible by User B",
			});

			const { entityId } = yield* createPluginSchemaAndEntity(clientB);

			const error = yield* Effect.flip(
				clientB.call((c) =>
					c.collections.deleteMembership({ payload: { entityId, collectionId: collection.id } }),
				),
			);

			assertTaggedError(error, "NotFound");
			expect(error.message).toContain("Collection not found");
		}),
	);

	it.live("rejects unauthenticated requests", () =>
		Effect.gen(function* () {
			const client = getBackendClient();

			const error = yield* Effect.flip(
				client.call((c) =>
					c.collections.deleteMembership({
						payload: {
							entityId: EntityId.make("some-entity-id"),
							collectionId: EntityId.make("some-collection-id"),
						},
					}),
				),
			);

			assertTaggedError(error, "Unauthorized");
		}),
	);
});
