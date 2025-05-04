import { describe, expect, it } from "bun:test";
import { createFacetFixture } from "#/features/facets/test-fixtures";
import type { AppSavedView } from "#/features/saved-views/model";
import type { SidebarFacet } from "./Sidebar.types";
import { toSidebarData } from "./sidebar-data";

describe("toSidebarData", () => {
	it("maps live facets and saved views to sidebar data", () => {
		const facets = [
			createFacetFixture({
				sortOrder: 2,
				id: "facet-2",
				name: "Fitness",
				slug: "fitness",
				icon: "dumbbell",
				accentColor: "#2DD4BF",
			}),
			createFacetFixture({
				icon: "film",
				sortOrder: 1,
				id: "facet-1",
				name: "Media",
				slug: "media",
				accentColor: "#5B7FFF",
			}),
			createFacetFixture({
				sortOrder: 3,
				id: "facet-3",
				name: "Hidden",
				slug: "hidden",
				enabled: false,
			}),
		];
		const views: AppSavedView[] = [
			{
				id: "view-1",
				isBuiltin: true,
				name: "Currently Reading",
				queryDefinition: { entitySchemaIds: ["schema-1"] },
			},
		];

		const result = toSidebarData({ facets, views });
		const expectedFacets = [
			{
				icon: "film",
				sortOrder: 1,
				id: "facet-1",
				name: "Media",
				slug: "media",
				enabled: true,
				entitySchemas: [],
				accentColor: "#5B7FFF",
			},
			{
				sortOrder: 2,
				id: "facet-2",
				enabled: true,
				name: "Fitness",
				slug: "fitness",
				icon: "dumbbell",
				entitySchemas: [],
				accentColor: "#2DD4BF",
			},
		] as SidebarFacet[];

		expect(result.facets).toEqual(expectedFacets);
		expect(result.views).toEqual([
			{
				id: "view-1",
				icon: "book-open",
				name: "Currently Reading",
				slug: "currently-reading",
			},
		]);
	});
});
