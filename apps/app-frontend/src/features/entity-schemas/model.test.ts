import { describe, expect, it } from "bun:test";
import { createFacetFixture } from "#/features/facets/test-fixtures";
import type { AppEntitySchema } from "./model";
import { getFacetEntitySchemaViewState } from "./model";

function createEntitySchemaFixture(
	overrides: Partial<AppEntitySchema> = {},
): AppEntitySchema {
	return {
		name: "Schema",
		slug: "schema",
		id: "schema-id",
		isBuiltin: false,
		facetId: "facet-id",
		propertiesSchema: { type: "object", properties: {} },
		...overrides,
	};
}

describe("getFacetEntitySchemaViewState", () => {
	it("returns builtin for built-in facets", () => {
		const facet = createFacetFixture({ isBuiltin: true });

		const state = getFacetEntitySchemaViewState({
			facet,
			entitySchemas: [createEntitySchemaFixture()],
		});

		expect(state).toEqual({ type: "builtin" });
	});

	it("returns empty when a custom facet has no schemas", () => {
		const facet = createFacetFixture({ isBuiltin: false });

		const state = getFacetEntitySchemaViewState({
			facet,
			entitySchemas: [],
		});

		expect(state).toEqual({ type: "empty" });
	});

	it("returns sorted schemas for custom facets with schemas", () => {
		const facet = createFacetFixture({ isBuiltin: false });

		const state = getFacetEntitySchemaViewState({
			facet,
			entitySchemas: [
				createEntitySchemaFixture({ id: "2", name: "Bravo", slug: "bravo" }),
				createEntitySchemaFixture({ id: "3", name: "Alpha", slug: "zulu" }),
				createEntitySchemaFixture({ id: "1", name: "Alpha", slug: "alpha" }),
			],
		});

		expect(state.type).toBe("list");
		if (state.type !== "list") throw new Error("Expected list state");
		expect(state.entitySchemas.map((schema) => schema.slug)).toEqual([
			"alpha",
			"zulu",
			"bravo",
		]);
	});
});
