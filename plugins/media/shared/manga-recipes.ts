import { listStateActivityPropertiesField } from "./list-state-recipes";
import { mediaFlatRecipes, mediaNumberField } from "./media-recipes";

export const mangaRecipes = mediaFlatRecipes({
	slug: "manga",
	alias: "manga",
	consumptionUnit: "chapters",
	extraOverviewQueries: () => ({}),
	presentationFields: (entity) => ({ chapters: mediaNumberField(entity, "chapters") }),
	activityEventFields: (event) => ({ listState: listStateActivityPropertiesField(event) }),
	summaryFields: (entity) => ({
		volumes: mediaNumberField(entity, "volumes"),
		chapters: mediaNumberField(entity, "chapters"),
	}),
});
