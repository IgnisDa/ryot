import { propertyNumber } from "./entity-selections";
import {
	mediaFlatRecipes,
	mediaNumberSelection,
	mediaTimeSpentMeasure,
	mediaUnlinkedCreatorsOverviewQueries,
} from "./media-recipes";

export const audiobookRecipes = mediaFlatRecipes({
	slug: "audiobook",
	alias: "audiobook",
	groupSlug: "audiobook-group",
	summaryFields: mediaNumberSelection("runtime"),
	presentationFields: mediaNumberSelection("runtime"),
	extraOverviewQueries: mediaUnlinkedCreatorsOverviewQueries,
	measure: mediaTimeSpentMeasure((entity) => propertyNumber(entity, "runtime")),
});
