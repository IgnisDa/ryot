import { Schema } from "@ryot-app/plugin-kit/effect";
import { isNull, selectedField } from "@ryot-app/plugin-kit/ryotql";

import { propertyNumber } from "./entity-selections";
import { mediaFlatRecipes } from "./media-recipes";

export const mangaRecipes = mediaFlatRecipes({
	slug: "manga",
	alias: "manga",
	presentationFields: (entity) => ({
		chapters: selectedField(propertyNumber(entity, "chapters"), Schema.NullOr(Schema.Number)),
	}),
	measure: (_event, entity) => ({
		amount: propertyNumber(entity, "chapters"),
		isUnknown: isNull(propertyNumber(entity, "chapters")),
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
