import {
	mediaFlatRecipes,
	mediaNumberSelection,
	mediaWatchProviderSelection,
} from "./media-recipes";

export const movieRecipes = mediaFlatRecipes({
	slug: "movie",
	alias: "movie",
	groupSlug: "movie-group",
	consumptionUnit: "minutes",
	presentationFields: mediaNumberSelection("runtime"),
	summaryFields: (entity) => ({
		...mediaWatchProviderSelection(entity),
		...mediaNumberSelection("runtime")(entity),
	}),
});
