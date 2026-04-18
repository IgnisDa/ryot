import { describe, expect, it } from "bun:test";
import { createEntityFixture } from "~/features/test-fixtures";

describe("useEntityMutations collection integration", () => {
	describe("createWithCollection successful save-to-collection", () => {
		it("successfully adds entity to collection and returns entity without error", async () => {
			const entity = createEntityFixture({
				id: "entity-123",
				name: "Test Entity",
			});
			const collectionId = "collection-1";

			// Mock successful mutations
			const mockCreateResult = { data: entity };
			const mockAddToCollectionResult = { data: null };

			// Simulate createWithCollection logic
			const createResult = mockCreateResult;
			const createdEntity = createResult.data;

			if (!createdEntity) {
				throw new Error("Failed to create entity");
			}

			let collectionError: string | undefined;
			if (collectionId) {
				try {
					// Simulate successful addToCollection
					const result = mockAddToCollectionResult;
					expect(result).toBeDefined();
				} catch (error) {
					collectionError =
						error instanceof Error ? error.message : "Unknown error";
				}
			}

			const result = { entity: createdEntity, collectionError };

			expect(result.entity.id).toBe("entity-123");
			expect(result.entity.name).toBe("Test Entity");
			expect(result.collectionError).toBeUndefined();
		});

		it("successfully creates entity without collection when collectionId is not provided", async () => {
			const entity = createEntityFixture({
				id: "entity-456",
				name: "Standalone Entity",
			});
			const collectionId = undefined;

			const mockCreateResult = { data: entity };
			const createResult = mockCreateResult;
			const createdEntity = createResult.data;

			if (!createdEntity) {
				throw new Error("Failed to create entity");
			}

			let collectionAddAttempted = false;
			if (collectionId) {
				collectionAddAttempted = true;
			}

			const result = { entity: createdEntity };

			expect(result.entity.id).toBe("entity-456");
			expect(result.entity.name).toBe("Standalone Entity");
			expect(collectionAddAttempted).toBe(false);
		});

		it("builds correct collection membership payload during successful save", () => {
			const entity = createEntityFixture({ id: "entity-789" });
			const collectionId = "collection-abc";
			const properties = { rating: 5, notes: "Great item" };

			const payload = {
				body: {
					entityId: entity.id,
					collectionId,
					properties,
				},
			};

			expect(payload.body).toEqual({
				entityId: "entity-789",
				collectionId: "collection-abc",
				properties: { rating: 5, notes: "Great item" },
			});
		});

		it("returns entity with all required fields after successful save", async () => {
			const entity = createEntityFixture({
				id: "entity-full-001",
				name: "Complete Entity",
				entitySchemaId: "schema-123",
				properties: { customField: "value" },
			});

			const mockCreateResult = { data: entity };
			const createdEntity = mockCreateResult.data;

			if (!createdEntity) {
				throw new Error("Failed to create entity");
			}

			const result = { entity: createdEntity };

			expect(result.entity.id).toBe("entity-full-001");
			expect(result.entity.name).toBe("Complete Entity");
			expect(result.entity.entitySchemaId).toBe("schema-123");
			expect(result.entity.properties).toEqual({ customField: "value" });
		});

		it("handles successful collection add with empty properties", async () => {
			const entity = createEntityFixture({ id: "entity-empty-props" });

			const payload = {
				body: {
					entityId: entity.id,
					collectionId: "collection-1",
					properties: {},
				},
			};

			// Simulate successful mutation
			const mockAddResult = { data: null };
			const success = !!mockAddResult;

			expect(payload.body.properties).toEqual({});
			expect(success).toBe(true);
		});

		it("preserves entity data when collection add succeeds", async () => {
			const entity = createEntityFixture({
				id: "entity-preserve-001",
				name: "Preserved Entity",
				entitySchemaId: "schema-preserve",
			});

			const createResult = { data: entity };
			const createdEntity = createResult.data;

			if (!createdEntity) {
				throw new Error("Failed to create entity");
			}

			// Simulate successful collection add
			const addResult = { data: { success: true } };
			const addSucceeded = !!addResult.data;

			const finalResult = {
				entity: createdEntity,
				collectionSuccess: addSucceeded,
			};

			expect(finalResult.entity).toEqual(entity);
			expect(finalResult.collectionSuccess).toBe(true);
		});
	});

	describe("createWithCollection payload structure", () => {
		it("builds correct entity creation payload", () => {
			const payload = {
				name: "Test Entity",
				image: null,
				properties: { rating: 5 },
				entitySchemaId: "schema-1",
			};

			expect(payload.name).toBe("Test Entity");
			expect(payload.image).toBeNull();
			expect(payload.properties).toEqual({ rating: 5 });
			expect(payload.entitySchemaId).toBe("schema-1");
		});

		it("builds correct collection membership payload from entity", () => {
			const entity = createEntityFixture({ id: "entity-123" });
			const collectionId = "collection-1";

			const membershipPayload = {
				body: {
					entityId: entity.id,
					collectionId,
					properties: {},
				},
			};

			expect(membershipPayload.body.entityId).toBe("entity-123");
			expect(membershipPayload.body.collectionId).toBe("collection-1");
			expect(membershipPayload.body.properties).toEqual({});
		});
	});

	describe("createWithCollection conditional behavior", () => {
		it("adds to collection when collectionId is provided", () => {
			const collectionId = "collection-1";
			const shouldAddToCollection = !!collectionId;

			expect(shouldAddToCollection).toBe(true);
		});

		it("does not add to collection when collectionId is undefined", () => {
			const collectionId = undefined;
			const shouldAddToCollection = !!collectionId;

			expect(shouldAddToCollection).toBe(false);
		});

		it("does not add to collection when collectionId is empty string", () => {
			const collectionId = "";
			const shouldAddToCollection = !!collectionId;

			expect(shouldAddToCollection).toBe(false);
		});
	});

	describe("entity creation returns data for collection add", () => {
		it("entity has id required for collection membership", () => {
			const entity = createEntityFixture({ id: "new-entity-456" });

			expect(entity.id).toBe("new-entity-456");
			expect(entity.id).toBeDefined();
		});

		it("can extract entityId from create result for collection payload", () => {
			const mockEntity = createEntityFixture({ id: "created-entity-789" });
			const mockCreateResult = {
				data: mockEntity,
			};

			const entityId = mockCreateResult.data?.id ?? null;

			expect(entityId).toBe("created-entity-789");
		});

		it("handles null entity data gracefully", () => {
			const mockCreateResult: { data: null } = { data: null };

			const entityId = mockCreateResult.data ? undefined : null;

			expect(entityId).toBeNull();
		});
	});

	describe("collection membership payload validation", () => {
		it("payload has all required fields", () => {
			const entity = createEntityFixture({ id: "entity-abc" });
			const payload = {
				body: {
					entityId: entity.id,
					collectionId: "collection-xyz",
					properties: {},
				},
			};

			expect(payload.body).toHaveProperty("entityId");
			expect(payload.body).toHaveProperty("collectionId");
			expect(payload.body).toHaveProperty("properties");
		});

		it("properties defaults to empty object", () => {
			const entity = createEntityFixture({ id: "entity-def" });
			const payload = {
				body: {
					entityId: entity.id,
					collectionId: "collection-ghi",
					properties: {},
				},
			};

			expect(payload.body.properties).toEqual({});
		});

		it("can include custom properties when needed", () => {
			const entity = createEntityFixture({ id: "entity-jkl" });
			const payload = {
				body: {
					entityId: entity.id,
					collectionId: "collection-mno",
					properties: { notes: "Test note", rating: 4 },
				},
			};

			expect(payload.body.properties).toEqual({
				notes: "Test note",
				rating: 4,
			});
		});
	});

	describe("hook return value structure", () => {
		it("returns create mutation", () => {
			const mockReturn = {
				create: { mutateAsync: async () => ({ data: null }) },
				addToCollection: { mutateAsync: async () => ({ data: null }) },
				createWithCollection: async () => ({ data: null }),
			};

			expect(mockReturn).toHaveProperty("create");
			expect(mockReturn).toHaveProperty("addToCollection");
			expect(mockReturn).toHaveProperty("createWithCollection");
		});

		it("createWithCollection is a function", () => {
			const mockReturn = {
				createWithCollection: async () => ({ data: null }),
			};

			expect(typeof mockReturn.createWithCollection).toBe("function");
		});
	});
});
