import type { AppFacet } from "../model";

export function getFacetToggleUi(facet: Pick<AppFacet, "enabled"> | undefined) {
	if (!facet)
		return {
			color: "teal",
			visible: false,
			variant: "default",
			label: "Enable facet",
		} as const;

	if (facet.enabled)
		return {
			color: "red",
			visible: true,
			variant: "light",
			label: "Disable facet",
		} as const;

	return {
		color: "teal",
		visible: true,
		variant: "default",
		label: "Enable facet",
	} as const;
}
