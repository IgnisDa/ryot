import { Schema } from "@ryot-app/plugin-kit/effect";
import { and, coalesce, divide, isNull, literal, selectedField } from "@ryot-app/plugin-kit/ryotql";

import { propertyBoolean, propertyNumber } from "./entity-selections";
import { mediaFlatRecipes } from "./media-recipes";

const SECONDS_PER_MINUTE = 60;

export const musicRecipes = mediaFlatRecipes({
	slug: "music",
	alias: "music",
	groupSlug: "music-group",
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
	measure: (event, entity) => ({
		isUnknown: and(
			isNull(propertyNumber(event, "timeSpent")),
			isNull(propertyNumber(entity, "duration")),
		),
		amount: coalesce(
			propertyNumber(event, "timeSpent"),
			divide(propertyNumber(entity, "duration"), literal(SECONDS_PER_MINUTE)),
		),
	}),
});
