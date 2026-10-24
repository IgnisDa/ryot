import {
	mediaFlatRecipes,
	mediaNumberSelection,
	mediaUnlinkedCreatorsOverviewQueries,
} from "./media-recipes";

export const audiobookRecipes = mediaFlatRecipes({
	slug: "audiobook",
	alias: "audiobook",
	consumptionUnit: "minutes",
	groupSlug: "audiobook-group",
	activityEventFields: () => ({}),
	summaryFields: mediaNumberSelection("runtime"),
	presentationFields: mediaNumberSelection("runtime"),
	extraOverviewQueries: mediaUnlinkedCreatorsOverviewQueries,
});
