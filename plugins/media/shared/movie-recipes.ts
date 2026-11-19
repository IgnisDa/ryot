import { mediaFlatRecipes, mediaNumberField, mediaWatchProviderSelection } from "./media-recipes";
import { originalLanguageSelection } from "./original-language";

export const movieRecipes = mediaFlatRecipes({
	slug: "movie",
	alias: "movie",
	groupSlug: "movie-group",
	consumptionUnit: "minutes",
	activityEventFields: () => ({}),
	extraOverviewQueries: () => ({}),
	presentationFields: (entity) => ({ runtime: mediaNumberField(entity, "runtime") }),
	summaryFields: (entity) => ({
		...originalLanguageSelection(entity),
		...mediaWatchProviderSelection(entity),
		runtime: mediaNumberField(entity, "runtime"),
	}),
});
