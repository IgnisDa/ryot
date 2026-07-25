import { Schema } from "@ryot-app/plugin-kit/effect";
import { and, coalesce, isNull, selectedField, type Recipe } from "@ryot-app/plugin-kit/ryotql";

import { propertyNumber } from "./entity-selections";
import { mediaFlatRecipes, mediaWatchProviderSelection } from "./media-recipes";

const movieRecipes = mediaFlatRecipes({
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

export const {
	summaryRecipe: movieSummaryRecipe,
	overviewRecipe: movieOverviewRecipe,
	activityRecipe: movieActivityRecipe,
	presentationRecipe: moviePresentationRecipe,
} = movieRecipes;

export type MovieActivityEvent = MovieActivityResult["events"][number];
export type MovieSummaryResult = Recipe.Success<typeof movieSummaryRecipe>;
export type MovieActivityResult = Recipe.Success<typeof movieActivityRecipe>;
export type MovieOverviewResult = Recipe.Success<typeof movieOverviewRecipe>;
export type MoviePresentationData = Recipe.Success<typeof moviePresentationRecipe>[number];
