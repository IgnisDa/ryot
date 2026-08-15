import { propertyNumber } from "./entity-selections";
import {
	mediaFlatRecipes,
	mediaRuntimeSelection,
	mediaTimeSpentMeasure,
	mediaUnlinkedCreatorsOverviewQueries,
} from "./media-recipes";

export const audiobookRecipes = mediaFlatRecipes({
	slug: "audiobook",
	alias: "audiobook",
	groupSlug: "audiobook-group",
	summaryFields: mediaRuntimeSelection,
	presentationFields: mediaRuntimeSelection,
	extraOverviewQueries: mediaUnlinkedCreatorsOverviewQueries,
	measure: mediaTimeSpentMeasure((entity) => propertyNumber(entity, "runtime")),
});
