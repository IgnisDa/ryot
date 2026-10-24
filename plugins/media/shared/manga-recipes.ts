import { listStateActivityPropertiesField } from "./list-state-recipes";
import { mediaFlatRecipes, mediaNumberSelection } from "./media-recipes";

export const mangaRecipes = mediaFlatRecipes({
	slug: "manga",
	alias: "manga",
	consumptionUnit: "chapters",
	extraOverviewQueries: () => ({}),
	presentationFields: mediaNumberSelection("chapters"),
	summaryFields: mediaNumberSelection("volumes", "chapters"),
	activityEventFields: (event) => ({
		listState: listStateActivityPropertiesField(event),
		...mediaNumberSelection("mangaVolume", "mangaChapter")(event),
	}),
});
