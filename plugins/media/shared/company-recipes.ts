import { mediaCreatorRecipes } from "./creator-recipes";
import { mediaNumberField, mediaTextField } from "./media-recipes";

export const companyRecipes = mediaCreatorRecipes({
	slug: "company",
	alias: "company",
	creditFields: () => ({}),
	summaryFields: (entity) => ({
		website: mediaTextField(entity, "website"),
		sourceUrl: mediaTextField(entity, "sourceUrl"),
		foundedYear: mediaNumberField(entity, "foundedYear"),
		headquarters: mediaTextField(entity, "headquarters"),
	}),
});
