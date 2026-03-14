import type { AppFacet } from "./model";

export function applyFacetEnabledPatch(
	facets: AppFacet[],
	facetId: string,
	enabled: boolean,
): AppFacet[] {
	return facets.map((facet) =>
		facet.id === facetId ? { ...facet, enabled } : facet,
	);
}

export function applyFacetReorderPatch(
	facets: AppFacet[],
	facetIds: string[],
): AppFacet[] {
	const facetMap = new Map(facets.map((f) => [f.id, f]));
	const reordered: AppFacet[] = [];
	const seen = new Set<string>();

	for (const id of facetIds) {
		const facet = facetMap.get(id);
		if (facet) {
			reordered.push(facet);
			seen.add(id);
		}
	}

	for (const facet of facets) if (!seen.has(facet.id)) reordered.push(facet);

	return reordered.map((facet, index) => ({ ...facet, sortOrder: index + 1 }));
}
