import { Schema } from "@ryot-app/plugin-kit/effect";
import { selectedField } from "@ryot-app/plugin-kit/ryotql";

import { propertyNumber } from "./entity-selections";
import { mediaEntityCountMeasure, mediaFlatRecipes } from "./media-recipes";

export const mangaRecipes = mediaFlatRecipes({
	slug: "manga",
	alias: "manga",
	measure: mediaEntityCountMeasure("chapters"),
	presentationFields: (entity) => ({
		chapters: selectedField(propertyNumber(entity, "chapters"), Schema.NullOr(Schema.Number)),
	}),
	summaryFields: (entity) => ({
		volumes: selectedField(propertyNumber(entity, "volumes"), Schema.NullOr(Schema.Number)),
		chapters: selectedField(propertyNumber(entity, "chapters"), Schema.NullOr(Schema.Number)),
	}),
	activityEventFields: (event) => ({
		mangaVolume: selectedField(propertyNumber(event, "mangaVolume"), Schema.NullOr(Schema.Number)),
		mangaChapter: selectedField(
			propertyNumber(event, "mangaChapter"),
			Schema.NullOr(Schema.Number),
		),
	}),
});
