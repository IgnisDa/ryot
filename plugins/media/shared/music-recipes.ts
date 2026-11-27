import { Schema } from "@ryot-app/plugin-kit/effect";
import { selectedField } from "@ryot-app/plugin-kit/ryotql";

import { propertyBoolean } from "./entity-selections";
import { mediaFlatRecipes, mediaNumberField } from "./media-recipes";

export const musicRecipes = mediaFlatRecipes({
	slug: "music",
	alias: "music",
	groupSlug: "music-group",
	consumptionUnit: "minutes",
	activityEventFields: () => ({}),
	extraOverviewQueries: () => ({}),
	presentationFields: (entity) => ({ duration: mediaNumberField(entity, "duration") }),
	summaryFields: (entity) => ({
		duration: mediaNumberField(entity, "duration"),
		byVariousArtists: selectedField(
			propertyBoolean(entity, "byVariousArtists"),
			Schema.NullOr(Schema.Boolean),
		),
	}),
});
