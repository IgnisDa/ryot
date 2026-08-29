import { isNull } from "@ryot-app/plugin-kit/ryotql";

import { propertyNumber } from "../../../shared/entity-selections";
import { mediaFlatRecipes } from "../../../shared/media-recipes";

export const flatFixtureRecipes = mediaFlatRecipes({
	slug: "fixture",
	alias: "fixture",
	summaryFields: () => ({}),
	groupSlug: "fixture-group",
	presentationFields: () => ({}),
	measure: (event) => ({
		amount: propertyNumber(event, "timeSpent"),
		isUnknown: isNull(propertyNumber(event, "timeSpent")),
	}),
});
