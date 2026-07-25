import { Schema } from "@ryot-app/plugin-kit/effect";
import { divide, literal, selectedField } from "@ryot-app/plugin-kit/ryotql";

import { propertyBoolean, propertyNumber } from "./entity-selections";
import { mediaFlatRecipes, mediaNumberSelection, mediaTimeSpentMeasure } from "./media-recipes";

const SECONDS_PER_MINUTE = 60;

export const musicRecipes = mediaFlatRecipes({
	slug: "music",
	alias: "music",
	groupSlug: "music-group",
	presentationFields: mediaNumberSelection("duration"),
	measure: mediaTimeSpentMeasure((entity) =>
		divide(propertyNumber(entity, "duration"), literal(SECONDS_PER_MINUTE)),
	),
	summaryFields: (entity) => ({
		...mediaNumberSelection("duration")(entity),
		byVariousArtists: selectedField(
			propertyBoolean(entity, "byVariousArtists"),
			Schema.NullOr(Schema.Boolean),
		),
	}),
});
