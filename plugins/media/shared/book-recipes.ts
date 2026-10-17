import { Schema } from "@ryot-app/plugin-kit/effect";
import { selectedField } from "@ryot-app/plugin-kit/ryotql";

import { propertyBoolean } from "./entity-selections";
import {
	mediaEntityCountMeasure,
	mediaFlatRecipes,
	mediaNumberSelection,
	mediaUnlinkedCreatorsOverviewQueries,
} from "./media-recipes";

export const bookRecipes = mediaFlatRecipes({
	slug: "book",
	alias: "book",
	groupSlug: "book-group",
	measure: mediaEntityCountMeasure("pages"),
	presentationFields: mediaNumberSelection("pages"),
	extraOverviewQueries: mediaUnlinkedCreatorsOverviewQueries,
	summaryFields: (entity) => ({
		...mediaNumberSelection("pages")(entity),
		isCompilation: selectedField(
			propertyBoolean(entity, "isCompilation"),
			Schema.NullOr(Schema.Boolean),
		),
	}),
});
