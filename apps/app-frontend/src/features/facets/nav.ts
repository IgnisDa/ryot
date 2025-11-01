import type { AppFacet } from "./model";
import { sortFacetsByOrder } from "./model";

export type TrackingNavItem = {
	label: string;
	facetId: string;
	enabled: boolean;
	facetSlug: string;
	isBuiltin: boolean;
	icon?: string | null;
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
