import { propertyNumber } from "./entity-selections";
import {
	mediaFlatRecipes,
	mediaRuntimeSelection,
	mediaTimeSpentMeasure,
	mediaWatchProviderSelection,
} from "./media-recipes";

export const movieRecipes = mediaFlatRecipes({
	slug: "movie",
	alias: "movie",
	groupSlug: "movie-group",
	presentationFields: mediaRuntimeSelection,
	measure: mediaTimeSpentMeasure((entity) => propertyNumber(entity, "runtime")),
	summaryFields: (entity) => ({
		...mediaWatchProviderSelection(entity),
		...mediaRuntimeSelection(entity),
	}),
});
