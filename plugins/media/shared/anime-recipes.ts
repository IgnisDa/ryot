import { Schema } from "@ryot-app/plugin-kit/effect";
import { isNull, selectedField } from "@ryot-app/plugin-kit/ryotql";

import { AiringScheduleListSchema } from "./anime";
import { propertyJson, propertyNumber } from "./entity-selections";
import { mediaFlatRecipes } from "./media-recipes";

export const animeRecipes = mediaFlatRecipes({
	slug: "anime",
	alias: "anime",
	presentationFields: (entity) => ({
		episodes: selectedField(propertyNumber(entity, "episodes"), Schema.NullOr(Schema.Number)),
	}),
	measure: (_event, entity) => ({
		amount: propertyNumber(entity, "episodes"),
		isUnknown: isNull(propertyNumber(entity, "episodes")),
	}),
	activityEventFields: (event) => ({
		animeEpisode: selectedField(
			propertyNumber(event, "animeEpisode"),
			Schema.NullOr(Schema.Number),
		),
	}),
	summaryFields: (entity) => ({
		episodes: selectedField(propertyNumber(entity, "episodes"), Schema.NullOr(Schema.Number)),
		airingSchedule: selectedField(propertyJson(entity, "airingSchedule"), AiringScheduleListSchema),
	}),
});
