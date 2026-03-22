import { type AppFacet, sortFacetsByOrder } from "#/features/facets/model";
import type { AppSavedView } from "#/features/saved-views/model";
import type { SidebarFacet, SidebarView } from "./Sidebar.types";

export function toSidebarData(input: {
	facets: AppFacet[];
	views: AppSavedView[];
	isCustomizeMode?: boolean;
}): {
	views: SidebarView[];
	facets: SidebarFacet[];
} {
	const visibleFacets = input.isCustomizeMode
		? sortFacetsByOrder(input.facets)
		: sortFacetsByOrder(input.facets).filter((facet) => facet.enabled);
	const facetById = new Map(visibleFacets.map((facet) => [facet.id, facet]));
	const facets = visibleFacets.map((facet) => ({
		id: facet.id,
		name: facet.name,
		slug: facet.slug,
		icon: facet.icon,
		enabled: facet.enabled,
		sortOrder: facet.sortOrder,
		isBuiltin: facet.isBuiltin,
		accentColor: facet.accentColor,
		views: input.views
			.filter((view) => view.facetId === facet.id)
			.map((view) => ({
				id: view.id,
				icon: view.icon,
				name: view.name,
				facetSlug: facet.slug,
				facetId: view.facetId,
				accentColor: view.accentColor,
			})),
	}));
	const views = input.views
		.filter((view) => view.facetId === null)
		.map((view) => ({
			id: view.id,
			icon: view.icon,
			name: view.name,
			facetSlug: view.facetId
				? (facetById.get(view.facetId)?.slug ?? null)
				: null,
			facetId: view.facetId,
			accentColor: view.accentColor,
		}));

	return { views, facets };
}
