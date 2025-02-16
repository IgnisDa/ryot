import type { CreateFacetFormValues } from "./form";
import type { AppFacet } from "./model";

export function createFacetFixture(
	overrides: Partial<AppFacet> = {},
): AppFacet {
	return {
		sortOrder: 1,
		name: "Facet",
		slug: "facet",
		enabled: true,
		id: "facet-id",
		icon: "shapes",
		...overrides,
	};
}

export function createFacetFormValuesFixture(
	overrides: Partial<CreateFacetFormValues> = {},
): CreateFacetFormValues {
	return {
		name: "Facet",
		slug: "facet",
		icon: "shapes",
		accentColor: "",
		description: "",
		...overrides,
	};
}
