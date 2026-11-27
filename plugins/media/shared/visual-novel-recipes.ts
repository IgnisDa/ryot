import { mediaFlatRecipes, mediaNumberField } from "./media-recipes";

export const visualNovelRecipes = mediaFlatRecipes({
	slug: "visual-novel",
	alias: "visualNovel",
	consumptionUnit: "minutes",
	activityEventFields: () => ({}),
	extraOverviewQueries: () => ({}),
	summaryFields: (entity) => ({ lengthMinutes: mediaNumberField(entity, "lengthMinutes") }),
	presentationFields: (entity) => ({ lengthMinutes: mediaNumberField(entity, "lengthMinutes") }),
});
