import { selectedField } from "@ryot-app/plugin-kit/ryotql";

import { AiringScheduleListSchema } from "./anime";
import { propertyJson } from "./entity-selections";
import { listStateActivityPropertiesField } from "./list-state-recipes";
import { mediaEntityCountMeasure, mediaFlatRecipes, mediaNumberSelection } from "./media-recipes";

export const animeRecipes = mediaFlatRecipes({
	slug: "anime",
	alias: "anime",
	measure: mediaEntityCountMeasure("episodes"),
	presentationFields: mediaNumberSelection("episodes"),
	activityEventFields: (event) => ({
		listState: listStateActivityPropertiesField(event),
		...mediaNumberSelection("animeEpisode")(event),
	}),
	summaryFields: (entity) => ({
		...mediaNumberSelection("episodes")(entity),
		airingSchedule: selectedField(propertyJson(entity, "airingSchedule"), AiringScheduleListSchema),
	}),
});
