import { describe, expect, it } from "bun:test";
import { createSavedViewFixture } from "#/features/test-fixtures";
import { sortSavedViewsByOrder } from "./model";

describe("toAppSavedView", () => {
	it("converts raw API response to AppSavedView", () => {
		const result = createSavedViewFixture({
			name: "All Whiskeys",
		});

		expect(result.id).toBe("view-1");
		expect(result.icon).toBe("book-open");
		expect(result.name).toBe("All Whiskeys");
		expect(result.isBuiltin).toBe(true);
		expect(result.trackerId).toBe("tracker-1");
		expect(result.accentColor).toBe("#5B7FFF");
		expect(result.queryDefinition.entitySchemaSlugs).toEqual(["schema-1"]);
	});

	it("handles user-created saved views", () => {
		const result = createSavedViewFixture({
			id: "view-2",
			trackerId: null,
			icon: "sparkles",
			isBuiltin: false,
			name: "My Custom View",
			accentColor: "#2DD4BF",
			queryDefinition: {
				filters: [],
				entitySchemaSlugs: ["schema-1", "schema-2"],
				sort: { fields: ["entity.schema-1.@name"], direction: "asc" },
			},
		});

		expect(result.icon).toBe("sparkles");
		expect(result.isBuiltin).toBe(false);
		expect(result.trackerId).toBeNull();
		expect(result.accentColor).toBe("#2DD4BF");
		expect(result.queryDefinition.entitySchemaSlugs).toEqual([
			"schema-1",
			"schema-2",
		]);
	});
});

describe("sortSavedViewsByOrder", () => {
	it("sorts saved views by ascending sortOrder", () => {
		const views = [
			createSavedViewFixture({ id: "view-1", name: "C", sortOrder: 3 }),
			createSavedViewFixture({ id: "view-2", name: "A", sortOrder: 1 }),
			createSavedViewFixture({ id: "view-3", name: "B", sortOrder: 2 }),
		];

		const sorted = sortSavedViewsByOrder(views);

		expect(sorted.map((view) => view.id)).toEqual([
			"view-2",
			"view-3",
			"view-1",
		]);
	});

	it("breaks ties by name ascending", () => {
		const views = [
			createSavedViewFixture({ id: "view-1", name: "Zebra", sortOrder: 1 }),
			createSavedViewFixture({ id: "view-2", name: "Apple", sortOrder: 1 }),
			createSavedViewFixture({ id: "view-3", name: "Banana", sortOrder: 1 }),
		];

		const sorted = sortSavedViewsByOrder(views);

		expect(sorted.map((view) => view.id)).toEqual([
			"view-2",
			"view-3",
			"view-1",
		]);
	});
});
