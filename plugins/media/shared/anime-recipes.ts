import { selectedField } from "@ryot-app/plugin-kit/ryotql";

import { AiringScheduleListSchema } from "./anime";
import { propertyJson } from "./entity-selections";
import { listStateActivityPropertiesField } from "./list-state-recipes";
import { mediaFlatRecipes, mediaNumberField } from "./media-recipes";

export const animeRecipes = mediaFlatRecipes({
	slug: "anime",
	alias: "anime",
	consumptionUnit: "episodes",
	extraOverviewQueries: () => ({}),
	presentationFields: (entity) => ({ episodes: mediaNumberField(entity, "episodes") }),
	activityEventFields: (event) => ({
		listState: listStateActivityPropertiesField(event),
		animeEpisode: mediaNumberField(event, "animeEpisode"),
	}),
	summaryFields: (entity) => ({
		episodes: mediaNumberField(entity, "episodes"),
		airingSchedule: selectedField(propertyJson(entity, "airingSchedule"), AiringScheduleListSchema),
	}),
});
