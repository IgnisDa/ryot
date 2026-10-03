import { mediaCreatorRecipes } from "./creator-recipes";
import { creditCharacterSelection, mediaTextSelection } from "./media-recipes";

export const personRecipes = mediaCreatorRecipes({
	slug: "person",
	alias: "person",
	creditFields: creditCharacterSelection,
	summaryFields: mediaTextSelection(
		"birthDate",
		"deathDate",
		"birthPlace",
		"gender",
		"website",
		"sourceUrl",
	),
});
