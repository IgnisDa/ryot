import { kebabCase } from "@ryot/ts-utils";
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
	facets: SidebarFacet[];
	views: SidebarView[];
} {
	const facets = selectEnabledFacets(sortFacetsByOrder(input.facets)).map(
		(facet) => ({
			id: facet.id,
			name: facet.name,
			slug: facet.slug,
			icon: facet.icon,
			entitySchemas: [],
			enabled: facet.enabled,
			sortOrder: facet.sortOrder,
			accentColor: facet.accentColor,
		}),
	);
	const views = input.views.map((view) => ({
		id: view.id,
		name: view.name,
		icon: "book-open",
		slug: kebabCase(view.name),
	}));

	return { views, facets };
}
