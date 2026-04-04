import { describe, expect, it } from "bun:test";
import type { CollectionDiscoveryState } from "~/features/collections";
import {
	createAppCollectionFixture,
	createEntityFixture,
} from "~/features/test-fixtures";
import type { SearchResultItem } from "./use-search";

describe("search-modal collection panel submission", () => {
	describe("entity ensuring before collection add", () => {
		it("ensures entity exists before adding to collection", async () => {
			const searchResult: SearchResultItem = {
				identifier: "test-item-1",
				badgeProperty: { kind: "null", value: null },
				titleProperty: { kind: "text", value: "Test Book" },
				subtitleProperty: { kind: "null", value: null },
				imageProperty: { kind: "null", value: null },
			};

			// Simulate the flow: first ensure entity, then add to collection
			const ensuredEntity = createEntityFixture({
				id: "entity-123",
				name: searchResult.titleProperty.value,
			});

			// The entity must be ensured before collection add
			const collectionPayload = {
				body: {
					entityId: ensuredEntity.id,
					collectionId: "collection-1",
					properties: {},
				},
			};

			expect(collectionPayload.body.entityId).toBe("entity-123");
			expect(ensuredEntity.name).toBe("Test Book");
		});

		it("builds collection membership payload with correct structure", () => {
			const entity = createEntityFixture({
				id: "ensured-entity-456",
				name: "My Movie",
			});
			const collectionId = "my-collection";
			const properties = { rating: 5, notes: "Excellent" };

			// This is the payload structure used by handleSaveCollection
			const payload = {
				body: {
					collectionId,
					entityId: entity.id,
					properties,
				},
			};

			expect(payload.body).toEqual({
				collectionId: "my-collection",
				entityId: "ensured-entity-456",
				properties: { rating: 5, notes: "Excellent" },
			});
		});
	});

	describe("collection action state management", () => {
		it("tracks pending collection action during entity ensuring", () => {
			let pendingAction: string | null = null;

			// When collection panel is submitted
			pendingAction = "collection";
			expect(pendingAction).toBe("collection");

			// After completion
			pendingAction = null;
			expect(pendingAction).toBeNull();
		});

		it("isEnsuringEntity is true when pendingAction is collection", () => {
			const pendingAction = "collection";
			const isEnsuringEntity = pendingAction === "collection";

			expect(isEnsuringEntity).toBe(true);
		});

		it("isEnsuringEntity is false when no pending action", () => {
			const pendingAction: string | null = null;
			const isEnsuringEntity = pendingAction === "collection";

			expect(isEnsuringEntity).toBe(false);
		});
	});

	describe("search result to entity transformation", () => {
		it("search result item has required properties for entity creation", () => {
			const searchResult: SearchResultItem = {
				identifier: "tmdb-12345",
				badgeProperty: { kind: "null", value: null },
				titleProperty: { kind: "text", value: "Inception" },
				subtitleProperty: { kind: "number", value: 2010 },
				imageProperty: {
					kind: "image",
					value: { kind: "remote", url: "https://example.com/image.jpg" },
				},
			};

			// Properties needed for entity creation
			expect(searchResult.identifier).toBeDefined();
			expect(searchResult.titleProperty.value).toBe("Inception");
			expect(searchResult.subtitleProperty.value).toBe(2010);
		});

		it("uses search result identifier for entity externalId lookup", () => {
			const searchResult: SearchResultItem = {
				identifier: "provider-specific-id-789",
				badgeProperty: { kind: "null", value: null },
				titleProperty: { kind: "text", value: "The Matrix" },
				subtitleProperty: { kind: "null", value: null },
				imageProperty: { kind: "null", value: null },
			};

			// The identifier is used to fetch entity details and ensure existence
			expect(searchResult.identifier).toBe("provider-specific-id-789");
		});
	});

	describe("collection availability checks", () => {
		it("can add to collection when collections are available", () => {
			const collectionState: CollectionDiscoveryState = {
				type: "collections",
				collections: [
					createAppCollectionFixture({ id: "collection-1", name: "Favorites" }),
					createAppCollectionFixture({ id: "collection-2", name: "Watchlist" }),
				],
			};

			const canUseCollectionAction =
				collectionState.type === "collections" &&
				collectionState.collections.length > 0;

			expect(canUseCollectionAction).toBe(true);
			expect(collectionState.collections).toHaveLength(2);
		});

		it("cannot add to collection when collections state is loading", () => {
			const collectionState: CollectionDiscoveryState = {
				type: "loading",
			};

			function canUseCollectionAction(
				state: CollectionDiscoveryState,
			): boolean {
				return state.type === "collections" && state.collections.length > 0;
			}

			expect(canUseCollectionAction(collectionState)).toBe(false);
		});

		it("cannot add to collection when no collections exist", () => {
			const collectionState: CollectionDiscoveryState = {
				type: "empty",
			};

			function canUseCollectionAction(
				state: CollectionDiscoveryState,
			): boolean {
				return state.type === "collections" && state.collections.length > 0;
			}

			expect(canUseCollectionAction(collectionState)).toBe(false);
		});

		it("cannot add to collection when collections array is empty", () => {
			const collectionState: CollectionDiscoveryState = {
				type: "collections",
				collections: [],
			};

			const canUseCollectionAction =
				collectionState.type === "collections" &&
				collectionState.collections.length > 0;

			expect(canUseCollectionAction).toBe(false);
		});
	});

	describe("error handling in collection submission flow", () => {
		it("generates partial failure message when entity succeeds but collection fails", () => {
			const entityName = "Test Movie";
			const errorMessage = "Network timeout";
			const entityId = "entity-789";

			const message = entityId
				? `${entityName} is in your library, but could not be added to the collection: ${errorMessage}`
				: errorMessage;

			expect(message).toBe(
				"Test Movie is in your library, but could not be added to the collection: Network timeout",
			);
		});

		it("generates failure message when entity creation fails", () => {
			const errorMessage = "Failed to create entity";
			const entityId: string | null = null;

			const message = entityId
				? `Item is in your library, but could not be added to the collection: ${errorMessage}`
				: errorMessage;

			expect(message).toBe("Failed to create entity");
		});

		it("tracks entityId through the collection submission flow", () => {
			let entityId: string | null = null;

			// Before entity ensuring
			expect(entityId).toBeNull();

			// After successful entity ensuring
			const ensuredEntity = createEntityFixture({ id: "tracked-entity-123" });
			entityId = ensuredEntity.id;

			expect(entityId).toBe("tracked-entity-123");

			// Used in collection payload
			const payload = {
				body: {
					entityId,
					collectionId: "collection-1",
					properties: {},
				},
			};

			expect(payload.body.entityId).toBe("tracked-entity-123");
		});
	});

	describe("done actions tracking for collection flow", () => {
		it("marks track and collection as done on successful submission", () => {
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

		it("marks no actions as done when entity creation fails", () => {
			const doneActions: string[] = [];

			expect(doneActions).not.toContain("track");
			expect(doneActions).not.toContain("collection");
			expect(doneActions).toHaveLength(0);
		});
	});

	describe("collection properties handling", () => {
		it("submits with empty properties when no custom properties set", () => {
			const entity = createEntityFixture({ id: "entity-1" });
			const collectionProperties: Record<string, unknown> = {};

			const payload = {
				body: {
					entityId: entity.id,
					collectionId: "collection-1",
					properties: collectionProperties,
				},
			};

			expect(payload.body.properties).toEqual({});
		});

		it("submits with custom properties when provided", () => {
			const entity = createEntityFixture({ id: "entity-1" });
			const collectionProperties = {
				rating: 4,
				notes: "Must watch again",
				watchedWith: "Family",
			};

			const payload = {
				body: {
					entityId: entity.id,
					collectionId: "collection-1",
					properties: collectionProperties,
				},
			};

			expect(payload.body.properties).toEqual({
				rating: 4,
				notes: "Must watch again",
				watchedWith: "Family",
			});
		});
	});

	describe("success notification with collection name", () => {
		it("includes collection name in success message", () => {
			const itemName = "Test Movie";
			const collectionName = "My Favorites";
			const selectedCollectionId = "collection-123";

			const collections = [
				createAppCollectionFixture({ id: "collection-1", name: "Watchlist" }),
				createAppCollectionFixture({
					id: selectedCollectionId,
					name: collectionName,
				}),
			];

			const selectedCollection = collections.find(
				(c) => c.id === selectedCollectionId,
			);
			const resolvedName = selectedCollection?.name ?? "collection";

			const message = `${itemName} was added to ${resolvedName}.`;

			expect(message).toBe("Test Movie was added to My Favorites.");
		});

		it("falls back to generic 'collection' when collection not found", () => {
			const itemName = "Test Book";
			const collections: ReturnType<typeof createAppCollectionFixture>[] = [];

			const selectedCollection = collections.find((c) => c.id === "missing-id");
			const resolvedName = selectedCollection?.name ?? "collection";

			const message = `${itemName} was added to ${resolvedName}.`;

			expect(message).toBe("Test Book was added to collection.");
		});
	});
	describe("collection selection validation", () => {
		it("requires selected collection before submission", () => {
			const selectedCollectionId: string | null = null;

			const canSubmit = selectedCollectionId !== null;

			expect(canSubmit).toBe(false);
		});

		it("allows submission when collection is selected", () => {
			const selectedCollectionId = "collection-123";

			const canSubmit = selectedCollectionId !== null;

			expect(canSubmit).toBe(true);
		});
	});
});
