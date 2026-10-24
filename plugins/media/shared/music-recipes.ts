import { Schema } from "@ryot-app/plugin-kit/effect";
import { selectedField } from "@ryot-app/plugin-kit/ryotql";

import { propertyBoolean } from "./entity-selections";
import { mediaFlatRecipes, mediaNumberSelection } from "./media-recipes";

export const musicRecipes = mediaFlatRecipes({
	slug: "music",
	alias: "music",
	groupSlug: "music-group",
	consumptionUnit: "minutes",
	activityEventFields: () => ({}),
	extraOverviewQueries: () => ({}),
	presentationFields: mediaNumberSelection("duration"),
	summaryFields: (entity) => ({
		...mediaNumberSelection("duration")(entity),
		byVariousArtists: selectedField(
			propertyBoolean(entity, "byVariousArtists"),
			Schema.NullOr(Schema.Boolean),
		),
	}),
});
