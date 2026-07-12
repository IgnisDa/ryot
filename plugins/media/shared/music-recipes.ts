import { Schema } from "@ryot-app/plugin-kit/effect";
import { divide, literal, selectedField } from "@ryot-app/plugin-kit/ryotql";

import { propertyBoolean, propertyNumber } from "./entity-selections";
import { mediaFlatRecipes, mediaTimeSpentMeasure } from "./media-recipes";

const SECONDS_PER_MINUTE = 60;

export const musicRecipes = mediaFlatRecipes({
	slug: "music",
	alias: "music",
	groupSlug: "music-group",
	measure: mediaTimeSpentMeasure((entity) =>
		divide(propertyNumber(entity, "duration"), literal(SECONDS_PER_MINUTE)),
	),
	presentationFields: (entity) => ({
		duration: selectedField(propertyNumber(entity, "duration"), Schema.NullOr(Schema.Number)),
	}),
	summaryFields: (entity) => ({
		duration: selectedField(propertyNumber(entity, "duration"), Schema.NullOr(Schema.Number)),
		byVariousArtists: selectedField(
			propertyBoolean(entity, "byVariousArtists"),
			Schema.NullOr(Schema.Boolean),
		),
	}),
});
