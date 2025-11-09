import { kebabCase } from "@ryot/ts-utils";
import type { AppSavedView } from "../saved-views/model";
import { getSavedViewsForFacet } from "../saved-views/model";
import type { AppFacet } from "./model";
import { sortFacetsByOrder } from "./model";

export type TrackingNavItemSubItem = {
	id: string;
	name: string;
	viewSlug: string;
};

export type TrackingNavItem = {
	icon: string;
	label: string;
	facetId: string;
	enabled: boolean;
	facetSlug: string;
	isBuiltin: boolean;
	savedViews?: TrackingNavItemSubItem[];
};

export function toTrackingNavItems(facets: AppFacet[]): TrackingNavItem[] {
	const sorted = sortFacetsByOrder(facets);

	return sorted.map((facet) => ({
		icon: facet.icon,
		label: facet.name,
		facetId: facet.id,
		facetSlug: facet.slug,
		enabled: facet.enabled,
		isBuiltin: facet.isBuiltin ?? false,
	}));
}

export function toTrackingNavItemsWithViews(input: {
	facets: AppFacet[];
	savedViews: AppSavedView[];
	entitySchemasByFacet: Map<string, string[]>;
}): TrackingNavItem[] {
	const sorted = sortFacetsByOrder(input.facets);

	return sorted.map((facet) => {
		const entitySchemaIds = input.entitySchemasByFacet.get(facet.id) ?? [];
		const facetViews = getSavedViewsForFacet(input.savedViews, entitySchemaIds);

		const savedViews: TrackingNavItemSubItem[] | undefined =
			facetViews.length > 0
				? facetViews.map((view) => ({
						id: view.id,
						name: view.name,
						viewSlug: kebabCase(view.name),
					}))
				: undefined;

		return {
			savedViews,
			icon: facet.icon,
			label: facet.name,
			facetId: facet.id,
			facetSlug: facet.slug,
			enabled: facet.enabled,
			isBuiltin: facet.isBuiltin ?? false,
		};
	});
}
