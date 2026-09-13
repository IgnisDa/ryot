import { Schema } from "@ryot-app/plugin-kit/effect";
import { defineRecipe, isNull, selectedField, type Recipe } from "@ryot-app/plugin-kit/ryotql";

import { propertyBoolean, propertyNumber } from "./entity-selections";
import { mediaFlatRecipes, mediaUnlinkedCreatorsQuery } from "./media-recipes";

const bookRecipes = mediaFlatRecipes({
	slug: "book",
	alias: "book",
	groupSlug: "book-group",
	presentationFields: (entity) => ({
		pages: selectedField(propertyNumber(entity, "pages"), Schema.NullOr(Schema.Number)),
	}),
	measure: (_event, entity) => ({
		amount: propertyNumber(entity, "pages"),
		isUnknown: isNull(propertyNumber(entity, "pages")),
	}),
	summaryFields: (entity) => ({
		pages: selectedField(propertyNumber(entity, "pages"), Schema.NullOr(Schema.Number)),
		isCompilation: selectedField(
			propertyBoolean(entity, "isCompilation"),
			Schema.NullOr(Schema.Boolean),
		),
	}),
});

export const {
	summaryRecipe: bookSummaryRecipe,
	activityRecipe: bookActivityRecipe,
	presentationRecipe: bookPresentationRecipe,
} = bookRecipes;

export const bookOverviewRecipe = defineRecipe(
	(input: Parameters<typeof bookRecipes.overviewQueries>[0]) => ({
		queries: {
			...bookRecipes.overviewQueries(input),
			creators: mediaUnlinkedCreatorsQuery(input.entityId),
		},
	}),
);

export type BookActivityEvent = BookActivityResult["events"][number];
export type BookSummaryResult = Recipe.Success<typeof bookSummaryRecipe>;
export type BookActivityResult = Recipe.Success<typeof bookActivityRecipe>;
export type BookOverviewResult = Recipe.Success<typeof bookOverviewRecipe>;
export type BookPresentationData = Recipe.Success<typeof bookPresentationRecipe>[number];
