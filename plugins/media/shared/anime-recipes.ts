import { Schema } from "@ryot-app/plugin-kit/effect";
import { selectedField } from "@ryot-app/plugin-kit/ryotql";

import { AiringScheduleListSchema } from "./anime";
import { propertyJson, propertyNumber } from "./entity-selections";
import { mediaEntityCountMeasure, mediaFlatRecipes, mediaNumberSelection } from "./media-recipes";

export const animeRecipes = mediaFlatRecipes({
	slug: "anime",
	alias: "anime",
	measure: mediaEntityCountMeasure("episodes"),
	presentationFields: mediaNumberSelection("episodes"),
	activityEventFields: (event) => ({
		animeEpisode: selectedField(
			propertyNumber(event, "animeEpisode"),
			Schema.NullOr(Schema.Number),
		),
	}),
	summaryFields: (entity) => ({
		...mediaNumberSelection("episodes")(entity),
		airingSchedule: selectedField(propertyJson(entity, "airingSchedule"), AiringScheduleListSchema),
	}),
});
