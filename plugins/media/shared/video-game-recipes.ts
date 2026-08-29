import { Schema } from "@ryot-app/plugin-kit/effect";
import { isNull, selectedField, type Recipe } from "@ryot-app/plugin-kit/ryotql";

import { propertyJson, propertyNumber } from "./entity-selections";
import { mediaFlatRecipes } from "./media-recipes";
import { PlatformReleaseListSchema, TimeToBeatValueSchema } from "./video-game";

const videoGameRecipes = mediaFlatRecipes({
	slug: "video-game",
	alias: "videoGame",
	groupSlug: "video-game-group",
	measure: (event) => ({
		amount: propertyNumber(event, "timeSpent"),
		isUnknown: isNull(propertyNumber(event, "timeSpent")),
	}),
	presentationFields: (entity) => ({
		timeToBeatNormally: selectedField(
			propertyNumber(entity, "timeToBeat", "normally"),
			Schema.NullOr(Schema.Number),
		),
	}),
	summaryFields: (entity) => ({
		timeToBeat: selectedField(propertyJson(entity, "timeToBeat"), TimeToBeatValueSchema),
		platformReleases: selectedField(
			propertyJson(entity, "platformReleases"),
			PlatformReleaseListSchema,
		),
	}),
});

export const {
	summaryRecipe: videoGameSummaryRecipe,
	overviewRecipe: videoGameOverviewRecipe,
	activityRecipe: videoGameActivityRecipe,
	presentationRecipe: videoGamePresentationRecipe,
} = videoGameRecipes;

export type VideoGameActivityEvent = VideoGameActivityResult["events"][number];
export type VideoGameSummaryResult = Recipe.Success<typeof videoGameSummaryRecipe>;
export type VideoGameActivityResult = Recipe.Success<typeof videoGameActivityRecipe>;
export type VideoGameOverviewResult = Recipe.Success<typeof videoGameOverviewRecipe>;
export type VideoGamePresentationData = Recipe.Success<typeof videoGamePresentationRecipe>[number];
