import type { AppFacet } from "./model";
import { sortFacetsByOrder } from "./model";

export type TrackingNavItem = {
	icon?: string | null;
	label: string;
	enabled: boolean;
	facetId: string;
	facetSlug: string;
};

export function toTrackingNavItems(facets: AppFacet[]): TrackingNavItem[] {
	const sorted = sortFacetsByOrder(facets);

	return sorted.map((facet) => ({
		icon: facet.icon,
		label: facet.name,
		facetId: facet.id,
		facetSlug: facet.slug,
		enabled: facet.enabled,
	}));
}
