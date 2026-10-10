import { listStateActivityPropertiesField } from "./list-state-recipes";
import { mediaEntityCountMeasure, mediaFlatRecipes, mediaNumberSelection } from "./media-recipes";

export const mangaRecipes = mediaFlatRecipes({
	slug: "manga",
	alias: "manga",
	measure: mediaEntityCountMeasure("chapters"),
	presentationFields: mediaNumberSelection("chapters"),
	summaryFields: mediaNumberSelection("volumes", "chapters"),
	activityEventFields: (event) => ({
		listState: listStateActivityPropertiesField(event),
		...mediaNumberSelection("mangaVolume", "mangaChapter")(event),
	}),
});
