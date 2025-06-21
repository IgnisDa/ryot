import { describe, expect, it } from "bun:test";
import {
	createAppCollectionFixture,
	createQueryEngineCollectionFixture,
	createQueryEngineCollectionWithSchema,
} from "~/features/test-fixtures/collections";
import { getCollectionDiscoveryState, toAppCollection } from "./model";

describe("collection discovery data flow", () => {
	describe("toAppCollection integration", () => {
		it("returns collection with null membershipPropertiesSchema when fields are empty", () => {
			const entity = createQueryEngineCollectionFixture({
				id: "col-1",
				name: "Simple Collection",
			});

			const result = toAppCollection(entity);

			expect(result.id).toBe("col-1");
			expect(result.name).toBe("Simple Collection");
			expect(result.membershipPropertiesSchema).toBeNull();
		});

		it("returns collection with membershipPropertiesSchema for selector rendering", () => {
			const schema = {
				fields: {
					rating: { type: "integer", label: "Rating" },
					notes: { type: "string", label: "Notes" },
					priority: { type: "string", label: "Priority" },
				},
			};
			const entity = createQueryEngineCollectionWithSchema(
				"col-2",
				"Favorites",
				schema,
			);

			const result = toAppCollection(entity);

			expect(result.id).toBe("col-2");
			expect(result.name).toBe("Favorites");
			expect(result.membershipPropertiesSchema).not.toBeNull();
			expect(result.membershipPropertiesSchema?.fields).toBeDefined();
			expect(result.membershipPropertiesSchema?.fields.rating).toEqual({
				type: "integer",
				label: "Rating",
			});
			expect(result.membershipPropertiesSchema?.fields.notes).toEqual({
				type: "string",
				label: "Notes",
			});
		});

		it("returns all required data for search-modal collection selector", () => {
			const schema = {
				fields: {
					priority: { type: "string", label: "Priority Level" },
				},
			};
			const entity = createQueryEngineCollectionWithSchema(
				"col-3",
				"Watchlist",
				schema,
			);

			const result = toAppCollection(entity);

			// Verify all data needed for search-modal slices is present
			expect(result.id).toBeDefined();
			expect(result.name).toBeDefined();
			expect(result.membershipPropertiesSchema).toBeDefined();
			expect(result.image).toBeDefined();
			expect(result.entitySchemaSlug).toBe("collection");
		});
	});

	describe("getCollectionDiscoveryState with membershipPropertiesSchema", () => {
		it("returns loading state preserving future schema access capability", () => {
			const result = getCollectionDiscoveryState(true, false, []);

			expect(result.type).toBe("loading");
		});

		it("returns error state when collection discovery fails", () => {
			const result = getCollectionDiscoveryState(false, true, []);

			expect(result.type).toBe("error");
		});

		it("returns empty state when no collections available", () => {
			const result = getCollectionDiscoveryState(false, false, []);

			expect(result.type).toBe("empty");
		});

		it("returns collections state with full data including schema for each collection", () => {
			const schemaA = {
				fields: {
					rating: { type: "integer", label: "Rating" },
				},
			};
			const schemaB = { fields: {} };
			const collections = [
				toAppCollection(
					createQueryEngineCollectionWithSchema("col-a", "Rated", schemaA),
				),
				toAppCollection(
					createQueryEngineCollectionWithSchema("col-b", "Simple", schemaB),
				),
				toAppCollection(
					createQueryEngineCollectionFixture({
						id: "col-c",
						name: "No Schema",
					}),
				),
			];

			const result = getCollectionDiscoveryState(false, false, collections);

			expect(result.type).toBe("collections");
			if (result.type === "collections") {
				expect(result.collections).toHaveLength(3);

				const first = result.collections[0];
				expect(first?.id).toBe("col-a");
				expect(first?.membershipPropertiesSchema?.fields.rating).toBeDefined();

				const second = result.collections[1];
				expect(second?.id).toBe("col-b");
				expect(second?.membershipPropertiesSchema).not.toBeNull();

				const third = result.collections[2];
				expect(third?.id).toBe("col-c");
				expect(third?.membershipPropertiesSchema).toBeNull();
			}
		});
	});

	describe("collection selector data requirements", () => {
		it("provides membershipPropertiesSchema for form generation", () => {
			const schema = {
				fields: {
					note: { type: "string", label: "Personal Note" },
					dateAdded: { type: "string", label: "Date Added" },
				},
			};
			const entity = createQueryEngineCollectionWithSchema(
				"form-test",
				"Form Collection",
				schema,
			);

			const result = toAppCollection(entity);

			// Schema is needed to generate membership form fields
			expect(result.membershipPropertiesSchema).not.toBeNull();
			expect(result.membershipPropertiesSchema?.fields.note).toEqual({
				type: "string",
				label: "Personal Note",
			});
			expect(result.membershipPropertiesSchema?.fields.dateAdded).toEqual({
				type: "string",
				label: "Date Added",
			});
		});

		it("handles collections without membership properties schema gracefully", () => {
			const simpleCollection = createAppCollectionFixture({
				id: "simple",
				name: "Simple List",
				membershipPropertiesSchema: null,
			});

			const result = getCollectionDiscoveryState(false, false, [
				simpleCollection,
			]);

			expect(result.type).toBe("collections");
			if (result.type === "collections") {
				const collection = result.collections[0];
				expect(collection?.membershipPropertiesSchema).toBeNull();
			}
		});
	});
});
