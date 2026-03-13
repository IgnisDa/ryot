import { describe, expect, it } from "bun:test";
import { getSavedViewsForFacet, toAppSavedView } from "./model";

describe("toAppSavedView", () => {
	it("converts raw API response to AppSavedView", () => {
		const raw = {
			id: "view-1",
			icon: "book-open",
			name: "All Whiskeys",
			isBuiltin: true,
			facetId: "facet-1",
			accentColor: "#5B7FFF",
			queryDefinition: { entitySchemaIds: ["schema-1"] },
		};

		const result = toAppSavedView(raw);

		expect(result.id).toBe("view-1");
		expect(result.icon).toBe("book-open");
		expect(result.name).toBe("All Whiskeys");
		expect(result.isBuiltin).toBe(true);
		expect(result.facetId).toBe("facet-1");
		expect(result.accentColor).toBe("#5B7FFF");
		expect(result.queryDefinition.entitySchemaIds).toEqual(["schema-1"]);
	});

	it("handles user-created saved views", () => {
		const raw = {
			id: "view-2",
			icon: "sparkles",
			name: "My Custom View",
			isBuiltin: false,
			facetId: null,
			accentColor: "#2DD4BF",
			queryDefinition: { entitySchemaIds: ["schema-1", "schema-2"] },
		};

		const result = toAppSavedView(raw);

		expect(result.icon).toBe("sparkles");
		expect(result.isBuiltin).toBe(false);
		expect(result.facetId).toBeNull();
		expect(result.accentColor).toBe("#2DD4BF");
		expect(result.queryDefinition.entitySchemaIds).toEqual([
			"schema-1",
			"schema-2",
		]);
	});
});

describe("getSavedViewsForFacet", () => {
	it("returns views matching the facet id", () => {
		const views = [
			{
				id: "view-1",
				icon: "wine",
				name: "All Whiskeys",
				isBuiltin: true,
				facetId: "facet-1",
				accentColor: "#D4A574",
				queryDefinition: { entitySchemaIds: ["schema-1"] },
			},
			{
				id: "view-2",
				icon: "glass-water",
				name: "All Wines",
				isBuiltin: true,
				facetId: "facet-2",
				accentColor: "#F59E0B",
				queryDefinition: { entitySchemaIds: ["schema-2"] },
			},
			{
				id: "view-3",
				icon: "book-open",
				name: "All Books",
				isBuiltin: true,
				facetId: "facet-1",
				accentColor: "#5B7FFF",
				queryDefinition: { entitySchemaIds: ["schema-3"] },
			},
		];

		const result = getSavedViewsForFacet(views, "facet-1");

		expect(result.length).toBe(2);
		expect(result[0]?.id).toBe("view-1");
		expect(result[1]?.id).toBe("view-3");
	});

	it("returns empty array when no views match", () => {
		const views = [
			{
				id: "view-1",
				icon: "wine",
				name: "All Whiskeys",
				isBuiltin: true,
				facetId: "facet-1",
				accentColor: "#D4A574",
				queryDefinition: { entitySchemaIds: ["schema-1"] },
			},
		];

		const result = getSavedViewsForFacet(views, "facet-99");

		expect(result.length).toBe(0);
	});

	it("returns empty array for views without a facet id", () => {
		const views = [
			{
				id: "view-1",
				icon: "sparkles",
				name: "Multi-schema view",
				isBuiltin: false,
				facetId: null,
				accentColor: "#2DD4BF",
				queryDefinition: { entitySchemaIds: ["schema-1", "schema-2"] },
			},
		];

		const result = getSavedViewsForFacet(views, "facet-1");

		expect(result.length).toBe(0);
	});

	it("returns empty array when views is empty", () => {
		const result = getSavedViewsForFacet([], "facet-1");

		expect(result.length).toBe(0);
	});
});
