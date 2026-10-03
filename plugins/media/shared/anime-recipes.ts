import { Schema } from "@ryot-app/plugin-kit/effect";
import { selectedField } from "@ryot-app/plugin-kit/ryotql";

import { AiringScheduleListSchema } from "./anime";
import { propertyJson, propertyNumber } from "./entity-selections";
import { listStateActivityPropertiesField } from "./list-state-recipes";
import { mediaEntityCountMeasure, mediaFlatRecipes, mediaNumberSelection } from "./media-recipes";

export const animeRecipes = mediaFlatRecipes({
	slug: "anime",
	alias: "anime",
	measure: mediaEntityCountMeasure("episodes"),
	presentationFields: mediaNumberSelection("episodes"),
	summaryFields: (entity) => ({
		...mediaNumberSelection("episodes")(entity),
		airingSchedule: selectedField(propertyJson(entity, "airingSchedule"), AiringScheduleListSchema),
	}),
	activityEventFields: (event) => ({
		listState: listStateActivityPropertiesField(event),
		animeEpisode: selectedField(
			propertyNumber(event, "animeEpisode"),
			Schema.NullOr(Schema.Finite),
		),
	}),
});
