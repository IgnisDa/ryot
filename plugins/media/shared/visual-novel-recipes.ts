import { mediaFlatRecipes, mediaNumberSelection } from "./media-recipes";

export const visualNovelRecipes = mediaFlatRecipes({
	slug: "visual-novel",
	alias: "visualNovel",
	consumptionUnit: "minutes",
	summaryFields: mediaNumberSelection("lengthMinutes"),
	presentationFields: mediaNumberSelection("lengthMinutes"),
});
