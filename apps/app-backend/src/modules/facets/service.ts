const slugPunctuationRegex = /[^a-z0-9]+/g;
const edgeHyphenRegex = /^-+|-+$/g;

type FacetState = {
	slug: string;
	name: string;
	icon: string | null;
	description: string | null;
	accentColor: string | null;
};

type FacetPatchInput = {
	slug?: string;
	name?: string;
	icon?: string | null;
	description?: string | null;
	accentColor?: string | null;
};

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

export const resolveFacetPatch = (input: {
	current: FacetState;
	input: FacetPatchInput;
}) => {
	const name = input.input.name ?? input.current.name;
	const slug =
		input.input.name || input.input.slug
			? resolveFacetSlug({ name, slug: input.input.slug })
			: input.current.slug;

	return {
		name,
		slug,
		icon:
			input.input.icon === undefined ? input.current.icon : input.input.icon,
		description:
			input.input.description === undefined
				? input.current.description
				: input.input.description,
		accentColor:
			input.input.accentColor === undefined
				? input.current.accentColor
				: input.input.accentColor,
	};
};

export const buildFacetOrder = (input: {
	currentFacetIds: string[];
	requestedFacetIds: string[];
}) => {
	const requestedFacetIds = [...new Set(input.requestedFacetIds)];
	const requestedFacetSet = new Set(requestedFacetIds);
	const trailingFacetIds = input.currentFacetIds.filter(
		(facetId) => !requestedFacetSet.has(facetId),
	);

	return [...requestedFacetIds, ...trailingFacetIds];
};
