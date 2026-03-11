export interface AppFacet {
	id: string;
	icon: string;
	slug: string;
	name: string;
	enabled: boolean;
	sortOrder: number;
	config?: unknown;
	isBuiltin?: boolean;
	accentColor?: string | null;
	description?: string | null;
	mode?: "curated" | "generated";
}

export function sortFacetsByOrder(facets: AppFacet[]): AppFacet[] {
	return [...facets].sort((a, b) => {
		if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
		if (a.name !== b.name) return a.name.localeCompare(b.name);
		return a.slug.localeCompare(b.slug);
	});
}

export function selectEnabledFacets(facets: AppFacet[]): AppFacet[] {
	return facets.filter((facet) => facet.enabled);
}

export function findEnabledFacetBySlug(
	facets: AppFacet[],
	slug: string,
): AppFacet | undefined {
	return facets.find((facet) => facet.enabled && facet.slug === slug);
}
