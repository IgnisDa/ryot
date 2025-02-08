export const facetNotFoundError = "Facet not found";
export const customFacetError = "Built-in facets do not support entity schemas";

type FacetScope = {
	id: string;
	userId: string;
	isBuiltin: boolean;
};

export const resolveCustomFacetAccess = (facet: FacetScope | undefined) => {
	if (!facet) return { error: "not_found" as const };
	if (facet.isBuiltin) return { error: "builtin" as const };

	return { facet };
};
