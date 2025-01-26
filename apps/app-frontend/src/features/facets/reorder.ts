export function moveFacet(
	facetIds: string[],
	facetId: string | undefined,
	direction: "up" | "down",
): string[] {
	if (!facetId) return [...facetIds];

	const index = facetIds.indexOf(facetId);

	if (index === -1) return [...facetIds];

	if (direction === "up" && index === 0) return [...facetIds];

	if (direction === "down" && index === facetIds.length - 1)
		return [...facetIds];

	const result = [...facetIds];
	const currentFacetId = result[index];

	if (currentFacetId === undefined) return [...facetIds];

	if (direction === "up") {
		const previousFacetId = result[index - 1];
		if (previousFacetId === undefined) return [...facetIds];

		result[index - 1] = currentFacetId;
		result[index] = previousFacetId;
	} else {
		const nextFacetId = result[index + 1];
		if (nextFacetId === undefined) return [...facetIds];

		result[index] = nextFacetId;
		result[index + 1] = currentFacetId;
	}

	return result;
}
