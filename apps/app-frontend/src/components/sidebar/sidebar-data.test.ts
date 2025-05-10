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
				icon: "book-open",
				facetId: "facet-1",
				accentColor: "#5B7FFF",
				name: "Currently Reading",
				queryDefinition: { entitySchemaIds: ["schema-1"] },
			},
			{
				id: "view-2",
				facetId: null,
				icon: "sparkles",
				isBuiltin: false,
				name: "Favorites",
				accentColor: "#2DD4BF",
				queryDefinition: { entitySchemaIds: ["schema-2"] },
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
				isBuiltin: false,
				accentColor: "#5B7FFF",
				views: [
					{
						id: "view-1",
						icon: "book-open",
						facetId: "facet-1",
						accentColor: "#5B7FFF",
						name: "Currently Reading",
					},
				],
			},
			{
				views: [],
				sortOrder: 2,
				id: "facet-2",
				enabled: true,
				name: "Fitness",
				slug: "fitness",
				isBuiltin: false,
				icon: "dumbbell",
				accentColor: "#2DD4BF",
			},
		] as SidebarFacet[];

		expect(result.facets).toEqual(expectedFacets);
		expect(result.views).toEqual([
			{
				id: "view-2",
				facetId: null,
				icon: "sparkles",
				name: "Favorites",
				accentColor: "#2DD4BF",
			},
		]);
	});

	it("includes disabled facets while customizing", () => {
		const facets = [
			createFacetFixture({
				sortOrder: 2,
				id: "facet-2",
				name: "Hidden",
				slug: "hidden",
				enabled: false,
				icon: "eye-off",
				accentColor: "#A78BFA",
			}),
			createFacetFixture({
				sortOrder: 1,
				icon: "film",
				id: "facet-1",
				name: "Media",
				slug: "media",
				accentColor: "#5B7FFF",
			}),
		];

		const result = toSidebarData({
			views: [],
			facets,
			isCustomizeMode: true,
		});

		expect(result.facets.map((facet) => facet.id)).toEqual([
			"facet-1",
			"facet-2",
		]);
		expect(result.facets[1]?.enabled).toBe(false);
	});
});
