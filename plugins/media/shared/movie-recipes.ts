import { propertyNumber } from "./entity-selections";
import {
	mediaFlatRecipes,
	mediaNumberSelection,
	mediaTimeSpentMeasure,
	mediaWatchProviderSelection,
} from "./media-recipes";

export const movieRecipes = mediaFlatRecipes({
	slug: "movie",
	alias: "movie",
	groupSlug: "movie-group",
	presentationFields: mediaNumberSelection("runtime"),
	measure: mediaTimeSpentMeasure((entity) => propertyNumber(entity, "runtime")),
	summaryFields: (entity) => ({
		...mediaWatchProviderSelection(entity),
		...mediaNumberSelection("runtime")(entity),
	}),
});
