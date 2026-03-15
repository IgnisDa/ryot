import type { CreateFacetFormValues } from "./form";
import type { AppFacet } from "./model";

export function createFacetFixture(
	overrides: Partial<AppFacet> = {},
): AppFacet {
	return {
		id: "facet-id",
		name: "Facet",
		slug: "facet",
		enabled: true,
		sortOrder: 1,
		...overrides,
	};
}

export function createFacetFormValuesFixture(
	overrides: Partial<CreateFacetFormValues> = {},
): CreateFacetFormValues {
	return {
		icon: "",
		name: "Facet",
		slug: "facet",
		accentColor: "",
		description: "",
		...overrides,
	};
}
