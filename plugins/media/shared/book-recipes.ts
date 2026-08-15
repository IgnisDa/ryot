import { Schema } from "@ryot-app/plugin-kit/effect";
import { selectedField } from "@ryot-app/plugin-kit/ryotql";

import { propertyBoolean, propertyNumber } from "./entity-selections";
import {
	mediaEntityCountMeasure,
	mediaFlatRecipes,
	mediaUnlinkedCreatorsOverviewQueries,
} from "./media-recipes";

export const bookRecipes = mediaFlatRecipes({
	slug: "book",
	alias: "book",
	groupSlug: "book-group",
	measure: mediaEntityCountMeasure("pages"),
	extraOverviewQueries: mediaUnlinkedCreatorsOverviewQueries,
	presentationFields: (entity) => ({
		pages: selectedField(propertyNumber(entity, "pages"), Schema.NullOr(Schema.Number)),
	}),
	summaryFields: (entity) => ({
		pages: selectedField(propertyNumber(entity, "pages"), Schema.NullOr(Schema.Number)),
		isCompilation: selectedField(
			propertyBoolean(entity, "isCompilation"),
			Schema.NullOr(Schema.Boolean),
		),
	}),
});
