import { describe, expect, it } from "bun:test";
import { getSavedViewsForFacet, toAppSavedView } from "./model";

describe("toAppSavedView", () => {
	it("converts raw API response to AppSavedView", () => {
		const raw = {
			id: "view-1",
			isBuiltin: true,
			name: "All Whiskeys",
			queryDefinition: { entitySchemaIds: ["schema-1"] },
		};

		const result = toAppSavedView(raw);

		expect(result.id).toBe("view-1");
		expect(result.name).toBe("All Whiskeys");
		expect(result.isBuiltin).toBe(true);
		expect(result.queryDefinition.entitySchemaIds).toEqual(["schema-1"]);
	});

	it("handles user-created saved views", () => {
		const raw = {
			id: "view-2",
			isBuiltin: false,
			name: "My Custom View",
			queryDefinition: { entitySchemaIds: ["schema-1", "schema-2"] },
		};

		const result = toAppSavedView(raw);

		expect(result.isBuiltin).toBe(false);
		expect(result.queryDefinition.entitySchemaIds).toEqual([
			"schema-1",
			"schema-2",
		]);
	});
});

describe("getSavedViewsForFacet", () => {
	it("returns views matching any of the facet entity schema IDs", () => {
		const views = [
			{
				id: "view-1",
				isBuiltin: true,
				name: "All Whiskeys",
				queryDefinition: { entitySchemaIds: ["schema-1"] },
			},
			{
				id: "view-2",
				isBuiltin: true,
				name: "All Wines",
				queryDefinition: { entitySchemaIds: ["schema-2"] },
			},
			{
				id: "view-3",
				isBuiltin: true,
				name: "All Books",
				queryDefinition: { entitySchemaIds: ["schema-3"] },
			},
		];

		const result = getSavedViewsForFacet(views, ["schema-1", "schema-2"]);

		expect(result.length).toBe(2);
		expect(result[0]?.id).toBe("view-1");
		expect(result[1]?.id).toBe("view-2");
	});

	it("returns empty array when no views match", () => {
		const views = [
			{
				id: "view-1",
				isBuiltin: true,
				name: "All Whiskeys",
				queryDefinition: { entitySchemaIds: ["schema-1"] },
			},
		];

		const result = getSavedViewsForFacet(views, ["schema-99"]);

		expect(result.length).toBe(0);
	});

	it("handles views with multiple entity schema IDs", () => {
		const views = [
			{
				id: "view-1",
				isBuiltin: false,
				name: "Multi-schema view",
				queryDefinition: { entitySchemaIds: ["schema-1", "schema-2"] },
			},
		];

		const result = getSavedViewsForFacet(views, ["schema-2", "schema-3"]);

		expect(result.length).toBe(1);
		expect(result[0]?.id).toBe("view-1");
	});

	it("returns empty array when entitySchemaIds is empty", () => {
		const views = [
			{
				id: "view-1",
				isBuiltin: true,
				name: "All Whiskeys",
				queryDefinition: { entitySchemaIds: ["schema-1"] },
			},
		];

		const result = getSavedViewsForFacet(views, []);

		expect(result.length).toBe(0);
	});

	it("returns empty array when views is empty", () => {
		const result = getSavedViewsForFacet([], ["schema-1"]);

		expect(result.length).toBe(0);
	});
});
