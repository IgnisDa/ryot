import {
	type AppFacet,
	selectEnabledFacets,
	sortFacetsByOrder,
} from "#/features/facets/model";
import type { AppSavedView } from "#/features/saved-views/model";
import type { SidebarFacet, SidebarView } from "./Sidebar.types";

export function toSidebarData(input: {
	facets: AppFacet[];
	views: AppSavedView[];
}): {
	views: SidebarView[];
	facets: SidebarFacet[];
} {
	const facets = selectEnabledFacets(sortFacetsByOrder(input.facets)).map(
		(facet) => ({
			id: facet.id,
			name: facet.name,
			slug: facet.slug,
			icon: facet.icon,
			enabled: facet.enabled,
			sortOrder: facet.sortOrder,
			accentColor: facet.accentColor,
			views: input.views
				.filter((view) => view.facetId === facet.id)
				.map((view) => ({
					id: view.id,
					icon: view.icon,
					name: view.name,
					slug: view.name,
					facetId: view.facetId,
					accentColor: view.accentColor,
				})),
		}),
	);
	const views = input.views
		.filter((view) => view.facetId === null)
		.map((view) => ({
			id: view.id,
			icon: view.icon,
			name: view.name,
			slug: view.name,
			facetId: view.facetId,
			accentColor: view.accentColor,
		}));

	return { views, facets };
}
