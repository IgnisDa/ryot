import { describe, expect, it } from "bun:test";
import { toAppSavedView } from "./model";

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
