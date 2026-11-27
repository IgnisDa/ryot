import {
	mediaFlatRecipes,
	mediaNumberField,
	mediaUnlinkedCreatorsOverviewQueries,
} from "./media-recipes";

export const audiobookRecipes = mediaFlatRecipes({
	slug: "audiobook",
	alias: "audiobook",
	consumptionUnit: "minutes",
	groupSlug: "audiobook-group",
	activityEventFields: () => ({}),
	extraOverviewQueries: mediaUnlinkedCreatorsOverviewQueries,
	summaryFields: (entity) => ({ runtime: mediaNumberField(entity, "runtime") }),
	presentationFields: (entity) => ({ runtime: mediaNumberField(entity, "runtime") }),
});
