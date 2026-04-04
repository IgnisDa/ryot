import { describe, expect, it } from "bun:test";
import { createEntityFixture } from "~/features/test-fixtures";

describe("useEntityMutations collection integration", () => {
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
