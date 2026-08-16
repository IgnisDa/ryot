import { Schema } from "@ryot-app/plugin-kit/effect";
import { and, coalesce, isNull, selectedField } from "@ryot-app/plugin-kit/ryotql";

import { propertyNumber } from "./entity-selections";
import { mediaFlatRecipes, mediaWatchProviderSelection } from "./media-recipes";

export const movieRecipes = mediaFlatRecipes({
	slug: "movie",
	alias: "movie",
	groupSlug: "movie-group",
	presentationFields: (entity) => ({
		runtime: selectedField(propertyNumber(entity, "runtime"), Schema.NullOr(Schema.Number)),
	}),
	summaryFields: (entity) => ({
		...mediaWatchProviderSelection(entity),
		runtime: selectedField(propertyNumber(entity, "runtime"), Schema.NullOr(Schema.Number)),
	}),
	measure: (event, entity) => ({
		amount: coalesce(propertyNumber(event, "timeSpent"), propertyNumber(entity, "runtime")),
		isUnknown: and(
			isNull(propertyNumber(event, "timeSpent")),
			isNull(propertyNumber(entity, "runtime")),
		),
	}),
});
