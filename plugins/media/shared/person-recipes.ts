import { mediaCreatorRecipes } from "./creator-recipes";
import { creditCharacterSelection, mediaTextField } from "./media-recipes";

export const personRecipes = mediaCreatorRecipes({
	slug: "person",
	alias: "person",
	creditFields: creditCharacterSelection,
	summaryFields: (entity) => ({
		gender: mediaTextField(entity, "gender"),
		website: mediaTextField(entity, "website"),
		birthDate: mediaTextField(entity, "birthDate"),
		deathDate: mediaTextField(entity, "deathDate"),
		sourceUrl: mediaTextField(entity, "sourceUrl"),
		birthPlace: mediaTextField(entity, "birthPlace"),
	}),
});
