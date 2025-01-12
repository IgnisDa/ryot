const slugPunctuationRegex = /[^a-z0-9]+/g;
const edgeHyphenRegex = /^-+|-+$/g;

export const normalizeFacetSlug = (slug: string) => {
	return slug
		.trim()
		.toLowerCase()
		.replace(slugPunctuationRegex, "-")
		.replace(edgeHyphenRegex, "");
};

export const resolveFacetSlug = (input: { name: string; slug?: string }) => {
	const candidate = input.slug ?? input.name;
	const resolvedSlug = normalizeFacetSlug(candidate);

	if (!resolvedSlug) throw new Error("Facet slug is required");

	return resolvedSlug;
};
