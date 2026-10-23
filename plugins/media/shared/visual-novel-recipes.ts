import { propertyNumber } from "./entity-selections";
import { mediaFlatRecipes, mediaNumberSelection, mediaTimeSpentMeasure } from "./media-recipes";

export const visualNovelRecipes = mediaFlatRecipes({
	slug: "visual-novel",
	alias: "visualNovel",
	summaryFields: mediaNumberSelection("lengthMinutes"),
	presentationFields: mediaNumberSelection("lengthMinutes"),
	measure: mediaTimeSpentMeasure((entity) => propertyNumber(entity, "lengthMinutes")),
});
