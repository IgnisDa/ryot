import { describe, expect, it } from "bun:test";

import { createSavedViewFixture } from "~/features/test-fixtures";
import {
	createQueryEngineCollectionFixture,
	createQueryEngineCollectionWithSchema,
} from "~/features/test-fixtures/collections";

import {
	extractMembershipPropertiesSchema,
	findBuiltinCollectionsView,
	getCollectionDiscoveryState,
	resolveCollectionsDestination,
	toAppCollection,
} from "./model";

describe("extractMembershipPropertiesSchema", () => {
	it("returns null when fields do not contain membershipPropertiesSchema", () => {
		const fields: { key: string; kind: "text" | "json"; value: unknown }[] = [
			{ key: "name", kind: "text", value: "Some Name" },
		];

		const result = extractMembershipPropertiesSchema(fields);

		expect(result).toBeNull();
	});

	it("returns null when membershipPropertiesSchema field is not json kind", () => {
		const fields = [{ key: "membershipPropertiesSchema", kind: "text" as const, value: "{}" }];

		const result = extractMembershipPropertiesSchema(fields);

		expect(result).toBeNull();
	});

	it("returns null when schema has no fields property", () => {
		const fields = [
			{
				key: "membershipPropertiesSchema",
				kind: "json" as const,
				value: { type: "string" },
			},
		];

		const result = extractMembershipPropertiesSchema(fields);

		expect(result).toBeNull();
	});

	it("extracts membershipPropertiesSchema from json field with fields", () => {
		const schema = {
			fields: {
				rating: { type: "integer", label: "Rating", description: "Rating" },
				notes: { type: "string", label: "Notes", description: "Notes" },
			},
		};
		const fields = [
			{
				key: "membershipPropertiesSchema",
				kind: "json" as const,
				value: schema,
			},
		];

		const result = extractMembershipPropertiesSchema(fields);

		expect(result).not.toBeNull();
		if (result) {
			expect(result.fields.rating).toBeDefined();
			expect(result.fields.notes).toBeDefined();
		}
	});
});

describe("toAppCollection", () => {
	it("converts query engine entity to AppCollection", () => {
		const entity = createQueryEngineCollectionFixture({
			id: "col-1",
			name: "My Books",
		});

		const result = toAppCollection(entity);

		expect(result.id).toBe("col-1");
		expect(result.name).toBe("My Books");
		expect(result.entitySchemaSlug).toBe("collection");
		expect(result.membershipPropertiesSchema).toBeNull();
		expect(result.createdAt).toEqual(new Date("2026-03-08T08:00:00.000Z"));
		expect(result.updatedAt).toEqual(new Date("2026-03-08T08:30:00.000Z"));
	});

	it("extracts membershipPropertiesSchema when present", () => {
		const schema = {
			fields: {
				rating: { type: "integer", label: "Rating", description: "Rating" },
			},
		};
		const entity = createQueryEngineCollectionWithSchema("col-2", "Favorites", schema);

		const result = toAppCollection(entity);

		expect(result.id).toBe("col-2");
		expect(result.name).toBe("Favorites");
		expect(result.membershipPropertiesSchema).not.toBeNull();
		expect(result.membershipPropertiesSchema?.fields.rating).toBeDefined();
	});
});

describe("getCollectionDiscoveryState", () => {
	it("returns loading state when isLoading is true", () => {
		const result = getCollectionDiscoveryState(true, false, []);

		expect(result).toEqual({ type: "loading" });
	});

	it("returns error state when query fails", () => {
		const result = getCollectionDiscoveryState(false, true, []);

		expect(result).toEqual({ type: "error" });
	});

	it("returns empty state when not loading and no collections", () => {
		const result = getCollectionDiscoveryState(false, false, []);

		expect(result).toEqual({ type: "empty" });
	});

	it("returns collections state when collections exist", () => {
		const collections = [
			createQueryEngineCollectionWithSchema("col-1", "Favorites", {
				fields: {
					rating: {
						type: "integer",
						label: "Rating",
						description: "Rating",
					},
				},
			}),
		].map(toAppCollection);

		const result = getCollectionDiscoveryState(false, false, collections);

		expect(result.type).toBe("collections");
		if (result.type === "collections") {
			expect(result.collections).toHaveLength(1);
			const first = result.collections[0];
			if (first) {
				expect(first.id).toBe("col-1");
			}
		}
	});
});

describe("findBuiltinCollectionsView", () => {
	it("returns undefined when no matching view exists", () => {
		const views = [
			createSavedViewFixture({
				id: "view-1",
				isBuiltin: true,
				trackerId: null,
				queryDefinition: { scope: ["movie"] },
			}),
		];

		const result = findBuiltinCollectionsView(views);

		expect(result).toBeUndefined();
	});

	it("returns view when builtin collections view exists", () => {
		const views = [
			createSavedViewFixture({
				id: "view-collections",
				isBuiltin: true,
				trackerId: null,
				queryDefinition: { scope: ["collection"] },
			}),
		];

		const result = findBuiltinCollectionsView(views);

		expect(result).toBeDefined();
		expect(result?.id).toBe("view-collections");
	});

	it("returns undefined when view is not builtin", () => {
		const views = [
			createSavedViewFixture({
				id: "view-1",
				isBuiltin: false,
				trackerId: null,
				queryDefinition: { scope: ["collection"] },
			}),
		];

		const result = findBuiltinCollectionsView(views);

		expect(result).toBeUndefined();
	});

	it("returns undefined when view has trackerId", () => {
		const views = [
			createSavedViewFixture({
				id: "view-1",
				isBuiltin: true,
				trackerId: "tracker-1",
				queryDefinition: { scope: ["collection"] },
			}),
		];

		const result = findBuiltinCollectionsView(views);

		expect(result).toBeUndefined();
	});

	it("returns first matching view when multiple exist", () => {
		const views = [
			createSavedViewFixture({
				id: "view-collections",
				isBuiltin: true,
				trackerId: null,
				queryDefinition: { scope: ["collection", "movie"] },
			}),
		];

		const result = findBuiltinCollectionsView(views);

		expect(result?.id).toBe("view-collections");
	});
});

describe("resolveCollectionsDestination", () => {
	it("returns none when no builtin collections view exists", () => {
		const views: ReturnType<typeof createSavedViewFixture>[] = [];

		const result = resolveCollectionsDestination(views);

		expect(result).toEqual({ type: "none" });
	});

	it("returns view with id when builtin collections view exists", () => {
		const views = [
			createSavedViewFixture({
				isBuiltin: true,
				trackerId: null,
				slug: "collections",
				id: "view-collections",
				queryDefinition: { scope: ["collection"] },
			}),
		];

		const result = resolveCollectionsDestination(views);

		expect(result).toEqual({ type: "view", viewSlug: "collections" });
	});
});
