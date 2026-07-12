import { Schema } from "@ryot-app/plugin-kit/effect";
import { selectedField } from "@ryot-app/plugin-kit/ryotql";

import { propertyNumber } from "./entity-selections";
import { mediaEntityCountMeasure, mediaFlatRecipes, mediaNumberSelection } from "./media-recipes";

export const mangaRecipes = mediaFlatRecipes({
	slug: "manga",
	alias: "manga",
	measure: mediaEntityCountMeasure("chapters"),
	presentationFields: mediaNumberSelection("chapters"),
	summaryFields: mediaNumberSelection("volumes", "chapters"),
	activityEventFields: (event) => ({
		mangaVolume: selectedField(propertyNumber(event, "mangaVolume"), Schema.NullOr(Schema.Number)),
		mangaChapter: selectedField(
			propertyNumber(event, "mangaChapter"),
			Schema.NullOr(Schema.Number),
		),
	}),
});
