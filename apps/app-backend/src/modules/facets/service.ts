import { resolveRequiredSlug } from "@ryot/ts-utils";
import type { CreateFacetBody, UpdateFacetBody } from "./schemas";

type FacetState = {
	slug: string;
	name: string;
	icon: string;
	accentColor: string;
	description: string | null;
};

export const resolveFacetSlug = (
	input: Pick<CreateFacetBody, "name" | "slug">,
) => {
	return resolveRequiredSlug({
		name: input.name,
		label: "Facet",
		slug: input.slug,
	});
};

export const resolveFacetPatch = (input: {
	current: FacetState;
	input: UpdateFacetBody;
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
