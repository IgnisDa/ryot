import { selectedField } from "@ryot-app/plugin-kit/ryotql";

import { AiringScheduleListSchema } from "./anime";
import { propertyJson } from "./entity-selections";
import { listStateActivityPropertiesField } from "./list-state-recipes";
import { mediaFlatRecipes, mediaNumberSelection } from "./media-recipes";

export const animeRecipes = mediaFlatRecipes({
	slug: "anime",
	alias: "anime",
	consumptionUnit: "episodes",
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
