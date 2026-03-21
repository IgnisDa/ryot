import { describe, expect, it } from "bun:test";
import { FacetMode } from "~/lib/db/schema";
import {
	buildAuthenticationFacetEntitySchemaLinks,
	buildAuthenticationFacetInputs,
	buildAuthenticationSavedViewInputs,
	resolveAuthenticationName,
} from "./service";

describe("resolveAuthenticationName", () => {
	it("trims the provided signup name", () => {
		expect(resolveAuthenticationName("  New User  ")).toBe("New User");
	});

	it("throws when the signup name is blank", () => {
		expect(() => resolveAuthenticationName("   ")).toThrow(
			"Signup name is required",
		);
	});
});

describe("buildAuthenticationSavedViewInputs", () => {
	it("builds built-in facet inputs from manifests", () => {
		expect(
			buildAuthenticationFacetInputs({
				facets: [
					{
						icon: "film",
						slug: "media",
						name: "Media",
						accentColor: "#5B7FFF",
						mode: FacetMode.curated,
					},
				],
			}),
		).toEqual([
			{
				icon: "film",
				slug: "media",
				name: "Media",
				accentColor: "#5B7FFF",
				description: undefined,
				mode: FacetMode.curated,
			},
		]);
	});

	it("builds facet entity schema links from built-in manifests", () => {
		expect(
			buildAuthenticationFacetEntitySchemaLinks({
				facets: [{ id: "facet-1", slug: "media" }],
				entitySchemas: [{ id: "schema-1", slug: "book" }],
				schemaLinks: [{ slug: "book", facetSlug: "media" }],
			}),
		).toEqual([{ facetId: "facet-1", entitySchemaId: "schema-1" }]);
	});

	it("throws when a schema link references a missing facet", () => {
		expect(() =>
			buildAuthenticationFacetEntitySchemaLinks({
				facets: [],
				entitySchemas: [{ id: "schema-1", slug: "book" }],
				schemaLinks: [{ slug: "book", facetSlug: "media" }],
			}),
		).toThrow("Missing built-in facet for entity schema book");
	});

	it("builds built-in saved views from built-in entity schemas", () => {
		expect(
			buildAuthenticationSavedViewInputs({
				entitySchemas: [{ id: "schema-1", slug: "book" }],
				savedViews: [{ name: "All Books", entitySchemaSlug: "book" }],
			}),
		).toEqual([
			{
				isBuiltin: true,
				name: "All Books",
				queryDefinition: { entitySchemaIds: ["schema-1"] },
			},
		]);
	});

	it("throws when a saved view references a missing built-in entity schema", () => {
		expect(() =>
			buildAuthenticationSavedViewInputs({
				entitySchemas: [],
				savedViews: [{ name: "All Books", entitySchemaSlug: "book" }],
			}),
		).toThrow("Missing built-in entity schema for saved view All Books");
	});
});
