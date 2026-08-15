import { Schema } from "@ryot-app/plugin-kit/effect";
import { isNull, selectedField } from "@ryot-app/plugin-kit/ryotql";

import { propertyBoolean, propertyNumber } from "./entity-selections";
import { mediaFlatRecipes, mediaUnlinkedCreatorsQuery } from "./media-recipes";

export const bookRecipes = mediaFlatRecipes({
	slug: "book",
	alias: "book",
	groupSlug: "book-group",
	extraOverviewQueries: (input) => ({ creators: mediaUnlinkedCreatorsQuery(input.entityId) }),
	presentationFields: (entity) => ({
		pages: selectedField(propertyNumber(entity, "pages"), Schema.NullOr(Schema.Number)),
	}),
	measure: (_event, entity) => ({
		amount: propertyNumber(entity, "pages"),
		isUnknown: isNull(propertyNumber(entity, "pages")),
	}),
	summaryFields: (entity) => ({
		pages: selectedField(propertyNumber(entity, "pages"), Schema.NullOr(Schema.Number)),
		isCompilation: selectedField(
			propertyBoolean(entity, "isCompilation"),
			Schema.NullOr(Schema.Boolean),
		),
	}),
});
