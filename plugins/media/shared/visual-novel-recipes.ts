import { mediaFlatRecipes, mediaNumberSelection } from "./media-recipes";

export const visualNovelRecipes = mediaFlatRecipes({
	slug: "visual-novel",
	alias: "visualNovel",
	consumptionUnit: "minutes",
	activityEventFields: () => ({}),
	extraOverviewQueries: () => ({}),
	summaryFields: mediaNumberSelection("lengthMinutes"),
	presentationFields: mediaNumberSelection("lengthMinutes"),
});
