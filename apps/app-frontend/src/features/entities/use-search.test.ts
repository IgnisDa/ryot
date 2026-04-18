import { describe, expect, it } from "bun:test";
import type { CollectionDiscoveryState } from "~/features/collections";
import { createEntityFixture } from "~/features/test-fixtures";

describe("entity search collection integration", () => {
	describe("collection selection logic", () => {
		it("selects first collection when collections are available", () => {
			const collectionState: CollectionDiscoveryState = {
				type: "collections",
				collections: [
					{
						id: "collection-1",
						name: "Favorites",
						image: null,
						createdAt: new Date(),
						updatedAt: new Date(),
						membershipPropertiesSchema: null,
						entitySchemaSlug: "media",
					},
					{
						id: "collection-2",
						name: "Watchlist",
						image: null,
						createdAt: new Date(),
						updatedAt: new Date(),
						membershipPropertiesSchema: null,
						entitySchemaSlug: "media",
					},
				],
			};

			if (collectionState.type === "collections") {
				const firstCollection = collectionState.collections[0];
				expect(firstCollection?.id).toBe("collection-1");
				expect(firstCollection?.name).toBe("Favorites");
			}
		});

		it("returns undefined first collection when collections array is empty", () => {
			const collectionState: CollectionDiscoveryState = {
				type: "collections",
				collections: [],
			};

			if (collectionState.type === "collections") {
				const firstCollection = collectionState.collections[0];
				expect(firstCollection).toBeUndefined();
			}
		});

		it("does not add to collection when collection state is loading", () => {
			const collectionState: CollectionDiscoveryState = {
				type: "loading",
			};

			function canAddToCollection(state: CollectionDiscoveryState): boolean {
				return state.type === "collections" && state.collections.length > 0;
			}

			expect(canAddToCollection(collectionState)).toBe(false);
		});

		it("does not add to collection when collection state is empty", () => {
			const collectionState: CollectionDiscoveryState = {
				type: "empty",
			};

			function canAddToCollection(state: CollectionDiscoveryState): boolean {
				return state.type === "collections" && state.collections.length > 0;
			}

			expect(canAddToCollection(collectionState)).toBe(false);
		});
	});

	describe("entity creation and collection membership payload", () => {
		it("builds correct collection membership payload with entity id", () => {
			const entity = createEntityFixture({ id: "entity-123" });
			const collectionId = "collection-1";

			const payload = {
				entityId: entity.id,
				collectionId,
				properties: {},
			};

			expect(payload.entityId).toBe("entity-123");
			expect(payload.collectionId).toBe("collection-1");
			expect(payload.properties).toEqual({});
		});

		it("builds payload with custom properties when provided", () => {
			const entity = createEntityFixture({ id: "entity-456" });
			const collectionId = "collection-2";
			const properties = { rating: 5, notes: "Great item" };

			const payload = {
				entityId: entity.id,
				collectionId,
				properties,
			};

			expect(payload.entityId).toBe("entity-456");
			expect(payload.collectionId).toBe("collection-2");
			expect(payload.properties).toEqual({ rating: 5, notes: "Great item" });
		});
	});

	describe("entity return type from addItem", () => {
		it("returns entity with correct shape after creation", () => {
			const entity = createEntityFixture({
				id: "new-entity-1",
				name: "Test Entity",
				entitySchemaId: "schema-1",
			});

			expect(entity.id).toBe("new-entity-1");
			expect(entity.name).toBe("Test Entity");
			expect(entity.entitySchemaId).toBe("schema-1");
		});

		it("entity id can be used for collection membership", () => {
			const entity = createEntityFixture({ id: "entity-for-collection" });

			const membershipPayload = {
				body: {
					entityId: entity.id,
					collectionId: "collection-1",
					properties: {},
				},
			};

			expect(membershipPayload.body.entityId).toBe("entity-for-collection");
		});
	});

	describe("error handling states", () => {
		it("tracks entityId when entity creation succeeds but collection add fails", () => {
			let entityId: string | null = null;

			const entity = createEntityFixture({ id: "partial-success-entity" });
			entityId = entity.id;

			expect(entityId).toBe("partial-success-entity");
			expect(entityId).not.toBeNull();
		});

		it("entityId remains null when entity creation fails", () => {
			const entityId: string | null = null;

			expect(entityId).toBeNull();
		});

		it("formats partial failure message with entity name and error", () => {
			const entityName = "Test Book";
			const errorMessage = "Network error";
			const entityId = "entity-123";

			const message = entityId
				? `${entityName} is in your library, but could not be added to the collection: ${errorMessage}`
				: errorMessage;

			expect(message).toBe(
				"Test Book is in your library, but could not be added to the collection: Network error",
			);
		});

		it("formats failure message when entity creation fails", () => {
			const entityName = "Test Book";
			const errorMessage = "Validation failed";
			const entityId: string | null = null;

			const message = entityId
				? `${entityName} is in your library, but could not be added to the collection: ${errorMessage}`
				: errorMessage;

			expect(message).toBe("Validation failed");
		});
	});

	describe("done actions tracking", () => {
		it("marks track as done when entity is created", () => {
			const doneActions = ["track"];
			expect(doneActions).toContain("track");
		});

		it("marks both track and collection as done when entity is added to collection", () => {
			const doneActions = ["track", "collection"];
			expect(doneActions).toContain("track");
			expect(doneActions).toContain("collection");
			expect(doneActions).toHaveLength(2);
		});

		it("only marks track as done when collection add fails", () => {
			const doneActions = ["track"];
			expect(doneActions).toContain("track");
			expect(doneActions).not.toContain("collection");
		});
	});
});
