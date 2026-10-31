import { Schema } from "@ryot-app/plugin-kit/effect";
import { selectedField } from "@ryot-app/plugin-kit/ryotql";

import { propertyBoolean } from "./entity-selections";
import {
	mediaFlatRecipes,
	mediaNumberField,
	mediaUnlinkedCreatorsOverviewQueries,
} from "./media-recipes";

export const bookRecipes = mediaFlatRecipes({
	slug: "book",
	alias: "book",
	groupSlug: "book-group",
	consumptionUnit: "pages",
	activityEventFields: () => ({}),
	extraOverviewQueries: mediaUnlinkedCreatorsOverviewQueries,
	presentationFields: (entity) => ({ pages: mediaNumberField(entity, "pages") }),
	summaryFields: (entity) => ({
		pages: mediaNumberField(entity, "pages"),
		isCompilation: selectedField(
			propertyBoolean(entity, "isCompilation"),
			Schema.NullOr(Schema.Boolean),
		),
	}),
});
